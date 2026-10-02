/**
 * Creating and editing Redmine issues from TimeHuddle (plan area e, M6).
 *
 * The "New Ticket" button becomes a two-way dropdown only when Redmine is
 * linked; without a link it must stay an ordinary button, which is the
 * negative case worth pinning down.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`):
 * these assert what the dialogs send and how they react, never that Redmine
 * accepts it.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';
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

async function openCreateDialog(page: Page) {
  await page.getByRole('button', { name: 'New Ticket' }).click();
  await page.getByText('Redmine issue', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Redmine issue' })).toBeVisible({
    timeout: 15000,
  });
}

test.describe('Redmine issue create and edit', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('without a linked account, New Ticket stays a plain button', async ({ page }) => {
    await openTickets(page, { status: { connected: false } });

    await page.getByRole('button', { name: 'New Ticket' }).click();

    // It opens the Huddle composer directly rather than asking which system.
    await expect(page.getByPlaceholder('Ticket title')).toBeVisible();
    await expect(page.getByText('Redmine issue', { exact: true })).toHaveCount(0);
  });

  test('with a linked account, New Ticket asks which system', async ({ page }) => {
    await openTickets(page, linked);

    await page.getByRole('button', { name: 'New Ticket' }).click();

    await expect(page.getByText('TimeHuddle ticket', { exact: true })).toBeVisible();
    await expect(page.getByText('Redmine issue', { exact: true })).toBeVisible();
  });

  test('creates an issue and sends exactly what was filled in', async ({ page }) => {
    const { rm } = await openTickets(page, {
      ...linked,
      'issues.create': {
        baseUrl: BASE_URL,
        issue: issueDetail({ id: 77, subject: 'Export job times out' }),
        mismatches: [],
        issueId: 77,
        confirmed: true,
      },
    });

    await openCreateDialog(page);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Exports', exact: true }).click();
    await page.getByPlaceholder('What needs doing?').fill('Export job times out');
    await page.getByRole('button', { name: 'Create in Redmine' }).click();

    await expect.poll(() => rm.callCount('issues.create')).toBe(1);
    expect(rm.calls('issues.create')[0]).toMatchObject({
      projectId: 2,
      subject: 'Export job times out',
    });
  });

  test('confirms the new issue and links to it', async ({ page }) => {
    await openTickets(page, {
      ...linked,
      'issues.create': {
        baseUrl: BASE_URL,
        issue: issueDetail({ id: 77 }),
        mismatches: [],
        issueId: 77,
        confirmed: true,
      },
    });

    await openCreateDialog(page);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await page.getByPlaceholder('What needs doing?').fill('Something to do');
    await page.getByRole('button', { name: 'Create in Redmine' }).click();

    await expect(page.getByText('Created Redmine issue #77.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: 'Open in Redmine' })).toHaveAttribute(
      'href',
      `${BASE_URL}/issues/77`,
    );
  });

  test('cannot submit without a project and a subject', async ({ page }) => {
    await openTickets(page, linked);
    await openCreateDialog(page);

    const submit = page.getByRole('button', { name: 'Create in Redmine' });
    await expect(submit).toBeDisabled();

    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder('What needs doing?').fill('Now it has a subject');
    await expect(submit).toBeEnabled();
  });

  test('a refused create reports why and keeps the dialog open', async ({ page }) => {
    await openTickets(page, {
      ...linked,
      'issues.create': { error: 'forbidden', reason: 'You may not create issues there.' },
    });

    await openCreateDialog(page);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await page.getByPlaceholder('What needs doing?').fill('Doomed issue');
    await page.getByRole('button', { name: 'Create in Redmine' }).click();

    await expect(page.getByText('You may not create issues there.')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('heading', { name: 'New Redmine issue' })).toBeVisible();
  });

  test('an empty project list leaves the dialog unusable rather than broken', async ({ page }) => {
    await openTickets(page, { ...linked, 'projects.list': { projects: [] } });

    await openCreateDialog(page);

    await expect(page.getByRole('button', { name: 'Create in Redmine' })).toBeDisabled();
  });

  test('a failing formOptions after picking a project does not block the subject', async ({
    page,
  }) => {
    // Tracker/assignee/priority are optional — Redmine applies its own defaults
    // — so losing their options must not prevent creating the issue.
    await openTickets(page, {
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

    await openCreateDialog(page);
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option', { name: 'Intake', exact: true }).click();
    await page.getByPlaceholder('What needs doing?').fill('Still creatable');

    await expect(page.getByRole('button', { name: 'Create in Redmine' })).toBeEnabled();
  });

  test('opens the edit dialog for an existing issue from its row', async ({ page }) => {
    const { tickets } = await openTickets(page, {
      ...linked,
      'issues.get': { baseUrl: BASE_URL, issue: issueDetail(), journals: [] },
    });

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
