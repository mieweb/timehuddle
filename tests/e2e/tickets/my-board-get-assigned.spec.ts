/**
 * "Get issues assigned to me" on an empty My Board (#633, #736).
 *
 * The first fill of a board: one press asks Redmine for the user's assigned
 * issues and adds up to ten of them, each as the TimeHuddle ticket carrying it,
 * and a notice offers to add the rest, ten at a time.
 *
 * Redmine is stubbed (see `fixtures/redmine.ts`). So is the board, held in
 * memory here: the button only exists on an empty board, and the seed user's
 * real board is shared with every other spec. The tickets carrying the issues
 * are real, seeded in a team of this spec's own, so `tickets.carryIssue` finds
 * them without a Redmine to create them from.
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectTeamById } from '../fixtures/team';
import { connectedStatus, redmineIssue, relevantList, stubRedmine } from '../fixtures/redmine';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
const TEAM_CODE = 'E2EGETAS';
const ISSUE_IDS = Array.from({ length: 12 }, (_, i) => 101 + i);

type BoardRef = { sourceId: string; ticketId: string };

/** The seeded ticket carrying each issue, by issue id. */
let carrierOf: Map<number, string>;
let teamId: string;

async function withDb<T>(fn: (db: ReturnType<MongoClient['db']>) => Promise<T>): Promise<T> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    return await fn(client.db());
  } finally {
    await client.close();
  }
}

/** A team with the owner in it, and a ticket carrying each issue, assigned to the owner. */
async function seedCarriers(): Promise<void> {
  await withDb(async (db) => {
    await removeSeed(db);
    const owner = await db
      .collection('users')
      .findOne({ 'emails.address': TEST_USERS.owner1.email });
    const ownerId = String(owner!._id);
    // In the shared seed team's org, so the app lists it and keeps it selected.
    const seedTeam = await db.collection('teams').findOne({ code: 'TEST01' });
    const team = new ObjectId();
    teamId = team.toHexString();
    await db.collection('teams').insertOne({
      _id: team,
      name: 'Get Assigned Team',
      code: TEAM_CODE,
      orgId: seedTeam?.orgId,
      members: [ownerId],
      admins: [ownerId],
      isPersonal: false,
      createdAt: new Date(),
    });
    carrierOf = new Map();
    for (const issueId of ISSUE_IDS) {
      const _id = new ObjectId();
      carrierOf.set(issueId, _id.toHexString());
      await db.collection('tickets').insertOne({
        _id,
        teamId,
        title: `Assigned issue ${issueId}`,
        github: '',
        status: 'open',
        createdBy: ownerId,
        assignedTo: [ownerId],
        linkedIssue: { source: 'redmine', id: String(issueId) },
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, issueId)),
      });
    }
  });
}

async function removeSeed(db: ReturnType<MongoClient['db']>): Promise<void> {
  const teams = await db.collection('teams').find({ code: TEAM_CODE }).toArray();
  const ids = teams.map((t) => String(t._id));
  await db.collection('tickets').deleteMany({ teamId: { $in: ids } });
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
}

/** An in-memory My Board answering the `myBoard.*` calls. */
async function stubBoard(page: Page): Promise<BoardRef[]> {
  const board: BoardRef[] = [];
  await page.route('**/api/myBoard_*', async (route) => {
    const method = new URL(route.request().url()).pathname.split('/').pop();
    const refs = ((route.request().postDataJSON() ?? {}) as { refs?: BoardRef[] }).refs ?? [];
    let result: unknown;
    if (method === 'myBoard_addMany') {
      board.push(...refs);
      result = { addedCount: refs.length };
    } else if (method === 'myBoard_removeMany') {
      result = { removedCount: 0 };
    } else {
      result = { entries: board.map((ref) => ({ ...ref, addedAt: '2026-10-07T00:00:00Z' })) };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result }),
    });
  });
  return board;
}

/** Sign-in done, Redmine answering with `count` assigned issues, on an empty board. */
async function openEmptyBoard(page: Page, count: number): Promise<BoardRef[]> {
  const ids = ISSUE_IDS.slice(0, count);
  const issues = ISSUE_IDS.map((id) => redmineIssue({ id, subject: `Assigned issue ${id}` }));
  const board = await stubBoard(page);
  await stubRedmine(page, {
    status: connectedStatus(),
    // The issues the seeded tickets carry, as Redmine reads them: each one's
    // live status and assignee comes from here (#736).
    'issues.relevant': relevantList([], { linkedIssues: issues }),
    'issues.assignedIds': { issueIds: ids, nextOffset: null },
  });
  await page.goto('/app/tickets');
  await selectTeamById(page, teamId);
  return board;
}

const getAssigned = (page: Page) => page.getByRole('button', { name: 'Get issues assigned to me' });
const ticketRows = (page: Page) =>
  page.locator('.tickets-view-panel:visible [data-ticket-source="huddle"]');

test.describe('My Board — get issues assigned to me', () => {
  test.beforeAll(seedCarriers);
  test.afterAll(() => withDb(removeSeed));

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('adds the first ten as tickets, then the rest from the notice', async ({ page }) => {
    const board = await openEmptyBoard(page, 12);

    await getAssigned(page).click();

    // Each issue goes on as the ticket carrying it, in the server's order.
    await expect.poll(() => board.length).toBe(10);
    expect(board).toEqual(
      ISSUE_IDS.slice(0, 10).map((id) => ({ sourceId: 'huddle', ticketId: carrierOf.get(id) })),
    );
    await expect(ticketRows(page)).toHaveCount(10);
    await expect(getAssigned(page)).toHaveCount(0);
    await expect(page.getByText('2 more issues assigned to you in Redmine.')).toBeVisible();

    // Redmine is asked again; the ten already on the board are skipped.
    await page
      .getByRole('button', { name: 'Add 2 more issues assigned to you to My Board' })
      .click();
    await expect.poll(() => board.length).toBe(12);
    expect(board.slice(10)).toEqual(
      ISSUE_IDS.slice(10).map((id) => ({ sourceId: 'huddle', ticketId: carrierOf.get(id) })),
    );
    await expect(ticketRows(page)).toHaveCount(12);
    await expect(page.getByText(/assigned to you in Redmine/)).toHaveCount(0);
  });

  test('the notice survives a reload, without its count', async ({ page }) => {
    const board = await openEmptyBoard(page, 12);
    await getAssigned(page).click();

    await expect(page.getByText('2 more issues assigned to you in Redmine.')).toBeVisible();
    await page.reload();
    await expect(ticketRows(page)).toHaveCount(10);
    await expect(page.getByText('More issues may be assigned to you in Redmine.')).toBeVisible();

    // Still adds only what is off the board, now known from the board alone.
    await page
      .getByRole('button', { name: 'Add 10 more issues assigned to you to My Board' })
      .click();
    await expect.poll(() => board.length).toBe(12);
    await expect(page.getByText(/assigned to you in Redmine/)).toHaveCount(0);
  });

  test('stays dismissed once dismissed', async ({ page }) => {
    await openEmptyBoard(page, 12);
    await getAssigned(page).click();

    const notice = page.getByText(/assigned to you in Redmine/);
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(ticketRows(page)).toHaveCount(10);
    await expect(notice).toHaveCount(0);
  });

  test('ten or fewer are all added, with no notice', async ({ page }) => {
    await openEmptyBoard(page, 4);

    await getAssigned(page).click();

    await expect(ticketRows(page)).toHaveCount(4);
    await expect(page.getByText(/assigned to you/)).toHaveCount(0);
  });

  test('says so when nothing is assigned', async ({ page }) => {
    await openEmptyBoard(page, 0);

    await getAssigned(page).click();

    await expect(page.getByText('Nothing is assigned to you in Redmine right now.')).toBeVisible();
  });

  test('is not offered without a Redmine account', async ({ page }) => {
    await stubBoard(page);
    await stubRedmine(page, {});
    await page.goto('/app/tickets');

    await expect(page.getByRole('button', { name: 'Browse All Sources' })).toBeVisible();
    await expect(getAssigned(page)).toHaveCount(0);
  });
});
