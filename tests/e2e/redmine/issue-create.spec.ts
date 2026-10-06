/**
 * Creating a ticket that is tracked in Redmine, and editing a Redmine issue
 * (plan area e, M6; reworked in #638).
 *
 * There is one dialog for creating a ticket. "Tracked in → Redmine" either
 * links an existing issue or creates a new one from the ticket, asking only for
 * the project and tracker.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`), and
 * so is `tickets.link`, whose real path needs a Redmine account the test backend
 * does not have. These assert what the dialog sends and how it reacts, never
 * that Redmine accepts it.
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

const CREATED = {
  baseUrl: BASE_URL,
  issue: issueDetail({ id: 77, subject: 'Export job times out' }),
  mismatches: [],
  issueId: 77,
  confirmed: true,
};

const connectedList = (issues = [redmineIssue()]) => ({
  connected: true,
  baseUrl: BASE_URL,
  issues,
});

const linked = {
  status: connectedStatus(),
  'issues.relevant': connectedList(),
  'projects.list': PROJECTS,
  'projects.formOptions': FORM_OPTIONS,
};

async function openTickets(
  page: Page,
  overrides: Record<string, StubValue>,
): Promise<{ rm: RedmineStub; tickets: TicketsPage }> {
  const rm = await stubRedmine(page, overrides);
  const tickets = new TicketsPage(page);
  await tickets.goto();
  return { rm, tickets };
}

/** What `tickets.link` answers once the ticket is linked. Only the link matters here. */
const linkedTicket = (params: Record<string, unknown>) => ({
  id: params.ticketId,
  teamId: 'team',
  title: 'Linked',
  createdBy: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  linkedIssue: { source: 'redmine', id: String(params.issueId) },
});

/** Tickets these specs created, deleted again so they do not crowd later specs' tables. */
const createdTitles: string[] = [];

/** Opens New Ticket, fills the title, and chooses "Tracked in → Redmine → New issue". */
async function startNewRedmineTicket(page: Page): Promise<string> {
  const title = `Tracked in Redmine ${Date.now()}`;
  createdTitles.push(title);
  await page.getByRole('button', { name: 'New Ticket' }).click();
  await page.getByPlaceholder('Ticket title').fill(title);
  await page.getByRole('radio', { name: 'Redmine' }).check();
  await page.getByRole('radio', { name: 'New issue', exact: true }).check();
  return title;
}

const createButton = (page: Page) => page.getByRole('button', { name: 'Create Ticket' });

const chooseProject = async (page: Page, name: string) => {
  await page.getByRole('combobox', { name: 'Project' }).click();
  await page.getByRole('option', { name, exact: true }).click();
};

test.describe('Creating a ticket tracked in Redmine', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test.afterEach(async ({ page }) => {
    for (const title of createdTitles.splice(0)) await deleteTicket(page, title);
  });

  test('New Ticket is one dialog, with no menu asking which system', async ({ page }) => {
    await openTickets(page, linked);

    await page.getByRole('button', { name: 'New Ticket' }).click();

    await expect(page.getByPlaceholder('Ticket title')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'TimeHuddle', exact: true })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Link', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Redmine' })).toBeVisible();
  });

  test('a new Redmine issue asks only for project and tracker, and is made from the ticket', async ({
    page,
  }) => {
    const link = await stubTicketCall(page, 'tickets.link', linkedTicket);
    const { rm } = await openTickets(page, { ...linked, 'issues.create': CREATED });

    const title = await startNewRedmineTicket(page);
    await chooseProject(page, 'Exports');
    await expect(page.getByRole('combobox', { name: 'Tracker' })).toBeVisible();
    await createButton(page).click();

    // The issue takes its subject from the ticket and is assigned to the caller.
    await expect.poll(() => rm.callCount('issues.create')).toBe(1);
    expect(rm.calls('issues.create')[0]).toMatchObject({
      projectId: 2,
      trackerId: 1,
      subject: title,
      assigneeId: 8,
    });
    // Then the ticket is linked to it.
    await expect.poll(() => link.calls.length).toBe(1);
    expect(link.calls[0]).toMatchObject({ issueId: 77, expectedIssueId: null });
    await expect(page.getByPlaceholder('Ticket title')).toBeHidden();
  });

  test('links an existing issue after previewing it', async ({ page }) => {
    const link = await stubTicketCall(page, 'tickets.link', linkedTicket);
    const found = redmineIssue({ id: 482, subject: 'Export job times out' });
    await openTickets(page, {
      ...linked,
      'issues.search': { connected: true, baseUrl: BASE_URL, kind: 'id', issues: [found] },
    });

    const title = `Existing issue ${Date.now()}`;
    createdTitles.push(title);
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill(title);
    await page.getByRole('radio', { name: 'Redmine' }).check();

    // Nothing to link until an issue has been found.
    await expect(createButton(page)).toBeDisabled();
    await page.getByLabel('Issue number or link').fill('#482');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Issue to link' })).toContainText(
      'Export job times out',
    );

    await createButton(page).click();
    await expect.poll(() => link.calls.length).toBe(1);
    expect(link.calls[0]).toMatchObject({ issueId: 482, expectedIssueId: null });
  });

  test('cannot create a Redmine ticket without a project', async ({ page }) => {
    await openTickets(page, linked);
    await startNewRedmineTicket(page);
    createdTitles.pop(); // never created

    await expect(createButton(page)).toBeDisabled();
    await chooseProject(page, 'Intake');
    await expect(createButton(page)).toBeEnabled();
  });

  test('keeps the ticket when Redmine refuses the issue, and says why', async ({ page }) => {
    const { tickets } = await openTickets(page, {
      ...linked,
      'issues.create': { error: 'forbidden', reason: 'You may not create issues there.' },
    });

    const title = await startNewRedmineTicket(page);
    await chooseProject(page, 'Intake');
    await createButton(page).click();

    await expect(page.getByText(/The ticket was created, but it could not be linked/)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/You may not create issues there\./)).toBeVisible();
    await tickets.search(title);
    await expect(tickets.rowByTitle(title)).toHaveCount(1);
  });

  test('keeps the new issue when linking fails, and says which issue it is', async ({ page }) => {
    await stubTicketCall(page, 'tickets.link', () => ({
      error: 'unreachable',
      reason: 'Redmine did not answer.',
    }));
    await openTickets(page, { ...linked, 'issues.create': CREATED });

    await startNewRedmineTicket(page);
    await chooseProject(page, 'Intake');
    await createButton(page).click();

    await expect(
      page.getByText(/Redmine issue #77 was created, but linking it to this ticket failed\./),
    ).toBeVisible({ timeout: 15000 });
  });

  test('an empty project list leaves Redmine unusable rather than broken', async ({ page }) => {
    await openTickets(page, { ...linked, 'projects.list': { projects: [] } });
    await startNewRedmineTicket(page);
    createdTitles.pop(); // never created

    await expect(createButton(page)).toBeDisabled();
  });

  test('a failing tracker list does not block creating the issue', async ({ page }) => {
    // The tracker is optional: Redmine applies its own default without one.
    await openTickets(page, {
      ...linked,
      'projects.formOptions': { status: 500, reason: 'No options for you' },
    });
    await startNewRedmineTicket(page);
    createdTitles.pop(); // never created

    await chooseProject(page, 'Intake');
    await expect(createButton(page)).toBeEnabled();
  });

  test('opens the edit dialog for an existing issue from its row', async ({ page }) => {
    const { tickets } = await openTickets(page, {
      ...linked,
      'issues.get': { baseUrl: BASE_URL, issue: issueDetail(), journals: [] },
    });

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
