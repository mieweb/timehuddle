/**
 * Creating and editing Redmine issues from TimeHuddle (plan area e, M6).
 *
 * "New Ticket" always creates a TimeHuddle ticket (#636). A Redmine issue is
 * created from a ticket, through "Connect to… → New Redmine issue", which
 * pre-fills the form from the ticket and links the ticket to the new issue.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`):
 * these assert what the dialogs send and how they react, never that Redmine
 * accepts it.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';
import { deleteTicket, stubTicketCall } from '../tickets/helpers';
import {
  BASE_URL,
  connectedStatus,
  issueDetail,
  redmineIssue,
  stubRedmine,
  type RedmineStub,
  type StubValue,
} from '../fixtures/redmine';

const PROJECTS = {
  projects: [
    { id: 1, name: 'Intake' },
    { id: 2, name: 'Exports' },
  ],
};

const FORM_OPTIONS = {
  trackers: [
    { id: 1, name: 'Bug' },
    { id: 2, name: 'Feature' },
  ],
  assignees: [{ id: 8, name: 'Test User' }],
  priorities: [
    { id: 4, name: 'Normal', isDefault: true },
    { id: 5, name: 'High', isDefault: false },
  ],
  defaultPriorityId: 4,
  me: 8,
};

const connectedList = (issues = [redmineIssue()]) => ({
  connected: true,
  baseUrl: BASE_URL,
  issues,
});

async function openTickets(
  page: Page,
  overrides: Record<string, StubValue>,
): Promise<{ rm: RedmineStub; tickets: TicketsPage }> {
  const rm = await stubRedmine(page, overrides);
  const tickets = new TicketsPage(page);
  await tickets.goto();
  return { rm, tickets };
}

const linked = {
  status: connectedStatus(),
  'issues.relevant': connectedList(),
  'projects.list': PROJECTS,
  'projects.formOptions': FORM_OPTIONS,
};

/** Tickets these specs created, deleted again so they do not crowd later specs' tables. */
const createdTitles: string[] = [];

/** Creates a ticket and opens the Redmine create form from its "Connect to…" dialog. */
async function openCreateDialog(page: Page, tickets: TicketsPage): Promise<string> {
  const title = `Connect ${Date.now()}`;
  createdTitles.push(title);
  await tickets.createTicket(title);
  await tickets.search(title);
  await tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' }).click();
  await page.getByRole('menuitem', { name: 'Connect to…' }).click();
  await page.getByRole('tab', { name: 'New Redmine issue' }).click();
  await page.getByRole('button', { name: 'Create in Redmine…' }).click();
  await expect(page.getByRole('heading', { name: 'New Redmine issue' })).toBeVisible({
    timeout: 15000,
  });
  return title;
}

const createButton = (page: Page) =>
  page.getByRole('button', { name: 'Create in Redmine', exact: true });

/** What `tickets.link` answers once the ticket is linked. Only the link matters here. */
const linkedTicket = (params: Record<string, unknown>) => ({
  id: params.ticketId,
  teamId: 'team',
  title: 'Linked',
  createdBy: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  linkedIssue: { source: 'redmine', id: String(params.issueId) },
});

test.describe('Redmine issue create and edit', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test.afterEach(async ({ page }) => {
    for (const title of createdTitles.splice(0)) await deleteTicket(page, title);
  });

  test('New Ticket opens the ticket form directly, even with a linked account', async ({
    page,
  }) => {
    await openTickets(page, linked);

    await page.getByRole('button', { name: 'New Ticket' }).click();

    // No menu asking which system: every ticket starts as a TimeHuddle ticket.
    await expect(page.getByPlaceholder('Ticket title')).toBeVisible();
    await expect(page.getByText('Redmine issue', { exact: true })).toHaveCount(0);
  });

  test('pre-fills the issue from the ticket and sends what was filled in', async ({ page }) => {
    await stubTicketCall(page, 'tickets.link', linkedTicket);
    const { rm, tickets } = await openTickets(page, {
      ...linked,
      'issues.create': {
        baseUrl: BASE_URL,
        issue: issueDetail({ id: 77, subject: 'Export job times out' }),
        mismatches: [],
        issueId: 77,
        confirmed: true,
      },
    });

    const title = await openCreateDialog(page, tickets);
    // The ticket's title arrives as the subject; it can still be changed.
    await expect(page.getByPlaceholder('What needs doing?')).toHaveValue(title);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Exports', exact: true }).click();
    await page.getByPlaceholder('What needs doing?').fill('Export job times out');
    await createButton(page).click();

    await expect.poll(() => rm.callCount('issues.create')).toBe(1);
    expect(rm.calls('issues.create')[0]).toMatchObject({
      projectId: 2,
      subject: 'Export job times out',
    });
  });

  test('links the ticket to the issue it just created', async ({ page }) => {
    const link = await stubTicketCall(page, 'tickets.link', linkedTicket);
    const { tickets } = await openTickets(page, {
      ...linked,
      'issues.create': {
        baseUrl: BASE_URL,
        issue: issueDetail({ id: 77 }),
        mismatches: [],
        issueId: 77,
        confirmed: true,
      },
    });

    await openCreateDialog(page, tickets);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await createButton(page).click();

    await expect.poll(() => link.calls.length).toBe(1);
    expect(link.calls[0]).toMatchObject({ issueId: 77, expectedIssueId: null });
    // Both dialogs are gone once the ticket is linked.
    await expect(page.getByRole('heading', { name: 'New Redmine issue' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Connect to an external issue' })).toBeHidden();
  });

  test('keeps the new issue when linking fails, and offers to try again', async ({ page }) => {
    let attempts = 0;
    const link = await stubTicketCall(page, 'tickets.link', (params) =>
      ++attempts === 1
        ? { error: 'unreachable', reason: 'Redmine did not answer.' }
        : linkedTicket(params),
    );
    const { rm, tickets } = await openTickets(page, {
      ...linked,
      'issues.create': {
        baseUrl: BASE_URL,
        issue: issueDetail({ id: 77 }),
        mismatches: [],
        issueId: 77,
        confirmed: true,
      },
    });

    await openCreateDialog(page, tickets);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await createButton(page).click();

    await expect(
      page.getByText('Redmine issue #77 was created, but linking it to this ticket failed.'),
    ).toBeVisible({ timeout: 15000 });

    // The retry links the issue that already exists; it does not create another.
    await page.getByRole('button', { name: 'Try linking again' }).click();
    await expect.poll(() => link.calls.length).toBe(2);
    expect(rm.callCount('issues.create')).toBe(1);
    await expect(page.getByRole('heading', { name: 'Connect to an external issue' })).toBeHidden();
  });

  test('cannot submit without a project and a subject', async ({ page }) => {
    const { tickets } = await openTickets(page, linked);
    await openCreateDialog(page, tickets);

    // The subject arrives from the ticket, so only the project is missing.
    const submit = createButton(page);
    await expect(submit).toBeDisabled();

    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await expect(submit).toBeEnabled();

    await page.getByPlaceholder('What needs doing?').fill('');
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder('What needs doing?').fill('Now it has a subject');
    await expect(submit).toBeEnabled();
  });

  test('a refused create reports why and keeps the dialog open', async ({ page }) => {
    const { tickets } = await openTickets(page, {
      ...linked,
      'issues.create': { error: 'forbidden', reason: 'You may not create issues there.' },
    });

    await openCreateDialog(page, tickets);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await page.getByPlaceholder('What needs doing?').fill('Doomed issue');
    await createButton(page).click();

    await expect(page.getByText('You may not create issues there.')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('heading', { name: 'New Redmine issue' })).toBeVisible();
  });

  test('an empty project list leaves the dialog unusable rather than broken', async ({ page }) => {
    const { tickets } = await openTickets(page, { ...linked, 'projects.list': { projects: [] } });

    await openCreateDialog(page, tickets);

    await expect(createButton(page)).toBeDisabled();
  });

  test('a failing formOptions after picking a project does not block the subject', async ({
    page,
  }) => {
    // Tracker/assignee/priority are optional — Redmine applies its own defaults
    // — so losing their options must not prevent creating the issue.
    const { tickets } = await openTickets(page, {
      ...linked,
      'projects.formOptions': { status: 500, reason: 'No options for you' },
      'issues.create': {
        baseUrl: BASE_URL,
        issue: issueDetail({ id: 78 }),
        mismatches: [],
        issueId: 78,
        confirmed: true,
      },
    });

    await openCreateDialog(page, tickets);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await page.getByPlaceholder('What needs doing?').fill('Still creatable');

    await expect(createButton(page)).toBeEnabled();
  });

  test('opens the edit dialog for an existing issue from its row', async ({ page }) => {
    const { tickets } = await openTickets(page, {
      ...linked,
      'issues.get': { baseUrl: BASE_URL, issue: issueDetail(), journals: [] },
    });

    // Narrowed by search: the tickets the specs above created fill the first page.
    await tickets.search('Fix the intake form validation');
    await tickets
      .rowByTitle('Fix the intake form validation')
      .getByRole('button', { name: 'Ticket options' })
      .click();
    await page.getByRole('menuitem', { name: 'Edit Ticket' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Redmine issue #15' })).toBeVisible({
      timeout: 15000,
    });
  });
});
