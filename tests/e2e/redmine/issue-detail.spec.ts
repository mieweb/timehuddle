/**
 * The Redmine issue page at `/app/tickets/redmine/:id` (plan areas b and d).
 *
 * Covers loading, the inline description edit, the sidebar's status/priority/
 * assignee selects, the merged activity card, and the three states the page can
 * be in other than "fine": not connected, load failure, and stale.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`), so
 * these assert how the page reacts to a given server answer — never that
 * Redmine really refuses a stale write.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import {
  BASE_URL,
  issueDetail,
  stubRedmine,
  type RedmineStub,
  type StubValue,
} from '../fixtures/redmine';

const ISSUE_ID = 15;

const detailResponse = (overrides = {}) => ({
  baseUrl: BASE_URL,
  issue: issueDetail(overrides),
  journals: [
    {
      id: 1,
      user: { id: 3, name: 'Priya Patel' },
      createdAt: '2026-02-01T11:30:00.000Z',
      notes: 'Reproduced on staging.',
      changes: [{ field: 'status', from: 'New', to: 'In Progress' }],
    },
  ],
});

const formOptions = {
  trackers: [{ id: 1, name: 'Bug' }],
  assignees: [
    { id: 8, name: 'Test User' },
    { id: 3, name: 'Priya Patel' },
  ],
  priorities: [
    { id: 3, name: 'Low', isDefault: false },
    { id: 4, name: 'Normal', isDefault: true },
    { id: 5, name: 'High', isDefault: false },
  ],
  defaultPriorityId: 4,
  me: 8,
};

const sidebar = (page: Page) => page.getByLabel('Issue details sidebar');

/**
 * The stale/failure alert, picked out by its text.
 *
 * The page always carries a second `role="alert"` — the standing "Issues can't
 * be deleted from TimeHuddle" notice — so a bare `getByRole('alert')` matches
 * that one too.
 */
const staleAlert = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'changed in Redmine' });

async function openIssue(
  page: Page,
  overrides: Record<string, StubValue>,
  { wait = true } = {},
): Promise<RedmineStub> {
  const rm = await stubRedmine(page, {
    'projects.formOptions': formOptions,
    ...overrides,
  });
  await page.goto(`/app/tickets/redmine/${ISSUE_ID}`);
  if (wait) {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
  }
  return rm;
}

test.describe('Redmine issue detail', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('renders the issue, its reference and its sidebar', async ({ page }) => {
    await openIssue(page, { 'issues.get': detailResponse() });

    await expect(
      page.getByRole('heading', { level: 1, name: 'Fix the intake form validation' }),
    ).toBeVisible();
    await expect(page.getByText(`#${ISSUE_ID}`, { exact: true })).toBeVisible();
    await expect(page.getByText('Submitting the intake form', { exact: false })).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
  });

  test('shows Redmine history and your own timer sessions in one activity list', async ({
    page,
  }) => {
    await openIssue(page, { 'issues.get': detailResponse() });

    const activity = page.getByRole('list', { name: 'Ticket activity' });
    await expect(activity).toBeVisible();
    await expect(activity).toContainText('Reproduced on staging.');
  });

  test('Back to tickets returns to the table', async ({ page }) => {
    await openIssue(page, { 'issues.get': detailResponse() });

    await page.getByRole('button', { name: 'Back to tickets' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
  });

  test('edits the description inline and sends it to Redmine', async ({ page }) => {
    const rm = await openIssue(page, {
      'issues.get': detailResponse(),
      'issues.update': () => ({
        baseUrl: BASE_URL,
        issue: issueDetail({ description: 'Rewritten by the test.' }),
        mismatches: [],
      }),
    });

    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.getByLabel('Issue description').fill('Rewritten by the test.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Rewritten by the test.')).toBeVisible({ timeout: 15000 });
    expect(rm.calls('issues.update')[0]).toMatchObject({
      issueId: ISSUE_ID,
      edits: { description: 'Rewritten by the test.' },
    });
  });

  test('changing status sends only that field', async ({ page }) => {
    const rm = await openIssue(page, {
      'issues.get': detailResponse(),
      'issues.update': () => ({
        baseUrl: BASE_URL,
        issue: issueDetail({ status: { id: 3, name: 'Resolved', isClosed: false } }),
        mismatches: [],
      }),
    });

    await sidebar(page).getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Resolved', exact: true }).click();

    await expect.poll(() => rm.callCount('issues.update')).toBe(1);
    expect(rm.calls('issues.update')[0]).toMatchObject({ edits: { statusId: 3 } });
  });

  test('a stale refusal warns, offers Reload, and locks the controls', async ({ page }) => {
    await openIssue(page, {
      'issues.get': detailResponse(),
      'issues.update': { error: 'stale', reason: 'This issue changed in Redmine.' },
    });

    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.getByLabel('Issue description').fill('A doomed edit.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(staleAlert(page)).toBeVisible();
    await expect(staleAlert(page).getByRole('button', { name: 'Reload' })).toBeVisible();

    // Everything editable is off until the user takes the newer version. The
    // description composer stays open on a failed save — so the "Edit
    // description" button only exists again once it is dismissed.
    await expect(sidebar(page).getByRole('combobox', { name: 'Status' })).toBeDisabled();
    await expect(sidebar(page).getByRole('combobox', { name: 'Priority' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit description' })).toBeDisabled();
  });

  test('Reload after a stale refusal refetches and unlocks', async ({ page }) => {
    let subject = 'Fix the intake form validation';
    const rm = await openIssue(page, {
      'issues.get': () => ({ ...detailResponse(), issue: issueDetail({ subject }) }),
      'issues.update': { error: 'stale', reason: 'This issue changed in Redmine.' },
    });

    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.getByLabel('Issue description').fill('A doomed edit.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(staleAlert(page)).toBeVisible();

    subject = 'Someone else renamed this';
    const before = rm.callCount('issues.get');
    await page.getByRole('button', { name: 'Reload' }).click();

    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible({
      timeout: 15000,
    });
    expect(rm.callCount('issues.get')).toBeGreaterThan(before);
    await expect(staleAlert(page)).toHaveCount(0);
    await expect(sidebar(page).getByRole('combobox', { name: 'Status' })).toBeEnabled();
  });

  test('an unlinked account is told where to link one', async ({ page }) => {
    await openIssue(
      page,
      { 'issues.get': { error: 'not-connected', reason: 'No Redmine account linked' } },
      { wait: false },
    );

    await expect(page.getByText('Connect your Redmine account in Settings')).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole('button', { name: 'Go to Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Redmine' })).toBeVisible();
  });

  test('a failed load explains itself and offers a retry', async ({ page }) => {
    await openIssue(
      page,
      { 'issues.get': { status: 500, reason: 'Redmine is unreachable' } },
      { wait: false },
    );

    await expect(page.getByText('Redmine is unreachable')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('unresolved form options leave priority and assignee disabled, status usable', async ({
    page,
  }) => {
    // Status comes from the issue's own `allowedStatuses`; the other two need
    // the project's form options, so they stay off rather than offering a list
    // that would silently be wrong.
    await openIssue(page, {
      'issues.get': detailResponse(),
      'projects.formOptions': { status: 500, reason: 'No options' },
    });

    await expect(sidebar(page).getByRole('combobox', { name: 'Priority' })).toBeDisabled();
    await expect(sidebar(page).getByRole('combobox', { name: 'Assignee' })).toBeDisabled();
    await expect(sidebar(page).getByRole('combobox', { name: 'Status' })).toBeEnabled();
  });
});
