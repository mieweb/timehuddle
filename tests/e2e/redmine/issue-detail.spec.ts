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

import { createPlanRequiredTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import {
  BASE_URL,
  issueDetail,
  stubRedmine,
  type RedmineStub,
  type StubValue,
} from '../fixtures/redmine';
import { jsonResult, stubMyBoard, stubRunningTimer, stubTimerCreate } from '../fixtures/timers';

const ISSUE_ID = 15;

const detailResponse = (overrides = {}) => ({
  baseUrl: BASE_URL,
  // The caller's Redmine id, as `redmine.issues.get` returns it: the issue is
  // assigned to them (see `issueDetail`), which is how the page knows it is in
  // the table and needs no pin.
  me: 8,
  pinned: false,
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

  test('lists and adds TimeHuddle attachments on the issue', async ({ page }) => {
    // The backend gates `redmine` attachments on the caller's Redmine key, which
    // the stub account does not have, so answer the attachment calls here too.
    const saved = {
      id: 'a1',
      url: 'https://example.com/spec',
      type: 'link',
      title: 'Intake spec',
      thumbnail: null,
      attachedTo: { kind: 'redmine', id: String(ISSUE_ID) },
      addedBy: 'someone-else',
      addedAt: '2026-02-01T11:30:00.000Z',
    };
    const listed: unknown[] = [];
    const added: unknown[] = [];
    await page.route('**/api/attachments_*', async (route) => {
      const body = route.request().postDataJSON();
      const method = new URL(route.request().url()).pathname.split('/').pop();
      if (method === 'attachments_add') added.push(body);
      else listed.push(body);
      const result =
        method === 'attachments_add' ? { attachment: saved } : { attachments: [saved] };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result }),
      });
    });

    await openIssue(page, { 'issues.get': detailResponse() });

    const links = page.getByRole('list', { name: 'Attached links' });
    await expect(links.getByRole('link', { name: 'Intake spec' })).toBeVisible();
    expect(listed[0]).toEqual({ kind: 'redmine', id: String(ISSUE_ID) });
    await expect(page.getByRole('button', { name: 'Upload video to this ticket' })).toBeVisible();

    await page.getByRole('button', { name: 'Add link' }).click();
    await page.getByPlaceholder('https://...').fill('https://example.com/spec');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => added.length).toBe(1);
    expect(added[0]).toMatchObject({
      url: 'https://example.com/spec',
      attachedTo: { kind: 'redmine', id: String(ISSUE_ID) },
    });
  });

  test('shows Redmine history and your own timer sessions in one activity list', async ({
    page,
  }) => {
    await openIssue(page, { 'issues.get': detailResponse() });

    const activity = page.getByRole('list', { name: 'Ticket activity' });
    await expect(activity).toBeVisible();
    await expect(activity).toContainText('Reproduced on staging.');
  });

  test('shows time logged in Redmine, and filters to your own activity', async ({ page }) => {
    await openIssue(page, {
      'issues.get': {
        ...detailResponse(),
        me: 8,
        timeEntries: [
          {
            id: 900,
            user: { id: 3, name: 'Priya Patel' },
            hours: 1.5,
            activity: { id: 9, name: 'Development' },
            comments: 'Paired on the fix',
            spentOn: '2026-02-02',
            createdAt: '2026-02-02T16:20:00.000Z',
          },
          {
            id: 901,
            user: { id: 8, name: 'Test User' },
            hours: 0.25,
            activity: { id: 9, name: 'Development' },
            comments: '',
            spentOn: '2026-02-03',
            createdAt: '2026-02-03T10:00:00.000Z',
          },
        ],
      },
    });

    const activity = page.getByRole('list', { name: 'Ticket activity' });
    await expect(activity).toContainText('logged 1h 30m in Redmine');
    await expect(activity).toContainText('Paired on the fix');
    await expect(activity).toContainText('logged 15m in Redmine');
    await expect(activity).toContainText('Reproduced on staging.');

    await page.getByRole('button', { name: 'My activity' }).click();
    await expect(page.getByRole('button', { name: 'My activity' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(activity).toContainText('logged 15m in Redmine');
    await expect(activity).not.toContainText('Paired on the fix');
    await expect(activity).not.toContainText('Reproduced on staging.');

    await page.getByRole('button', { name: 'All' }).click();
    await expect(activity).toContainText('Paired on the fix');
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

test.describe('Redmine issue page timer', () => {
  let clock: ClockPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    clock = new ClockPage(page);
  });

  /**
   * The test backend has no Redmine, so the timer and My Board calls are
   * stubbed. `running` follows start and stop, so the page's own running-timer
   * tracking drives the button, as it does for a real timer.
   */
  async function stubTimer(
    page: Page,
    { onBoard = false, startError }: { onBoard?: boolean; startError?: string } = {},
  ) {
    const stops: Record<string, unknown>[] = [];
    let running = false;
    const starts = await stubTimerCreate(page, {
      startError,
      onStart: () => {
        running = true;
      },
    });
    await page.route('**/api/timers_stopSession', async (route) => {
      stops.push(route.request().postDataJSON());
      running = false;
      await route.fulfill(jsonResult({ session: { id: 's1' } }));
    });
    await stubRunningTimer(page, {
      ticketId: String(ISSUE_ID),
      title: 'Fix the intake form validation',
      isRunning: () => running,
    });
    const { adds: boardAdds } = await stubMyBoard(
      page,
      onBoard ? [{ sourceId: 'redmine', ticketId: String(ISSUE_ID) }] : [],
    );
    return { starts, stops, boardAdds };
  }

  const startButton = (page: Page) =>
    page.getByRole('button', { name: `Start a timer on #${ISSUE_ID}` });
  const stopButton = (page: Page) =>
    page.getByRole('button', { name: `Stop the timer on #${ISSUE_ID}` });

  test('starts and stops a timer from the header', async ({ page }) => {
    await clock.ensureClockedIn();
    const { starts, stops } = await stubTimer(page, { onBoard: true });
    const rm = await openIssue(page, { 'issues.get': detailResponse() });

    await expect(startButton(page)).toHaveText('Start timer');
    await startButton(page).click();

    // Assigned to you and already on My Board: the timer just starts.
    await expect(page.getByText(`Timer started on #${ISSUE_ID}. It's on My Board`)).toBeVisible();
    expect(starts[0]).toMatchObject({
      ticketId: String(ISSUE_ID),
      source: 'redmine',
      startNow: true,
    });
    expect(rm.calls('prefs.set')).toHaveLength(0);
    await expect(stopButton(page)).toHaveText('Stop timer');

    await stopButton(page).click();

    await expect(page.getByText(`Timer stopped on #${ISSUE_ID}`)).toBeVisible();
    expect(stops[0]).toMatchObject({ sessionId: 's1' });
    await expect(startButton(page)).toBeVisible();
  });

  test('an issue not in your table is pinned and added to My Board', async ({ page }) => {
    await clock.ensureClockedIn();
    const { boardAdds } = await stubTimer(page);
    const rm = await openIssue(page, {
      'issues.get': detailResponse({ assignedTo: { id: 3, name: 'Priya Patel' } }),
      'prefs.set': { ok: true },
    });

    await startButton(page).click();

    await expect(
      page.getByText(`Timer started on #${ISSUE_ID} and added to My Board`),
    ).toBeVisible();
    expect(rm.calls('prefs.set')).toContainEqual({ issueId: ISSUE_ID, state: 'pinned' });
    expect(boardAdds[0]).toEqual({ refs: [{ sourceId: 'redmine', ticketId: String(ISSUE_ID) }] });
  });

  test('an issue you already pinned is not pinned again', async ({ page }) => {
    await clock.ensureClockedIn();
    const { boardAdds } = await stubTimer(page);
    const rm = await openIssue(page, {
      'issues.get': {
        ...detailResponse({ assignedTo: { id: 3, name: 'Priya Patel' } }),
        pinned: true,
      },
    });

    await startButton(page).click();

    await expect(
      page.getByText(`Timer started on #${ISSUE_ID} and added to My Board`),
    ).toBeVisible();
    expect(rm.calls('prefs.set')).toHaveLength(0);
    expect(boardAdds).toHaveLength(1);
  });

  test('at the pin limit the timer starts, and says it stayed off the table', async ({ page }) => {
    await clock.ensureClockedIn();
    const { boardAdds } = await stubTimer(page);
    await openIssue(page, {
      'issues.get': detailResponse({ assignedTo: null }),
      'prefs.set': { error: 'too-many-pins', status: 500 },
    });

    await startButton(page).click();

    await expect(page.getByText(/You've reached the 500-pin limit/)).toBeVisible();
    expect(boardAdds).toHaveLength(0);
  });

  test('clocked out, the prompt clocks in and then starts the timer', async ({ page }) => {
    await clock.ensureClockedOut();
    const { starts, boardAdds } = await stubTimer(page);
    await openIssue(page, {
      'issues.get': detailResponse({ assignedTo: null }),
      'prefs.set': { ok: true },
    });

    await startButton(page).click();
    await expect(page.getByRole('heading', { name: 'Clock In Required' })).toBeVisible();
    expect(starts).toHaveLength(0);
    await page.getByRole('button', { name: 'Clock In Now' }).click();

    await expect(
      page.getByText(`Timer started on #${ISSUE_ID} and added to My Board`),
    ).toBeVisible();
    expect(starts[0]).toMatchObject({ ticketId: String(ISSUE_ID), source: 'redmine' });
    expect(boardAdds).toHaveLength(1);
  });

  test('plan required: plan on the Clock page, then the issue timer starts and you are back', async ({
    page,
  }) => {
    test.slow();
    await clock.ensureClockedOut();
    await createPlanRequiredTeam(page);
    const { starts, boardAdds } = await stubTimer(page);
    const rm = await openIssue(page, {
      'issues.get': detailResponse({ assignedTo: null }),
      'prefs.set': { ok: true },
    });

    await startButton(page).click();
    await expect(
      page.getByText(/Your team asks for today's plan before you clock in/),
    ).toBeVisible();
    await page.getByRole('button', { name: "Write today's plan" }).click();

    await expect(page).toHaveURL(/\/app\/clock(\?|$)/);
    await expect(
      page.getByText(`The timer on #${ISSUE_ID} starts when you clock in.`),
    ).toBeVisible();
    expect(starts).toHaveLength(0);
    await clock.typePlan(`Plan before timing #${ISSUE_ID}`);
    await clock.postPlanAndClockIn();

    // Back on the issue page, timing it: pinned into the table and on My Board.
    await expect(page).toHaveURL(new RegExp(`/app/tickets/redmine/${ISSUE_ID}$`), {
      timeout: 15000,
    });
    await expect(
      page.getByText(`Timer started on #${ISSUE_ID} and added to My Board`),
    ).toBeVisible();
    expect(starts[0]).toMatchObject({ ticketId: String(ISSUE_ID), source: 'redmine' });
    expect(rm.calls('prefs.set')).toContainEqual({ issueId: ISSUE_ID, state: 'pinned' });
    expect(boardAdds).toHaveLength(1);

    await clock.ensureClockedOut();
  });

  test('a refused start says why', async ({ page }) => {
    await clock.ensureClockedIn();
    await stubTimer(page, { startError: 'no-active-shift' });
    await openIssue(page, { 'issues.get': detailResponse() });

    await startButton(page).click();

    await expect(page.getByText('Clock in to start a ticket timer.')).toBeVisible();
    await expect(startButton(page)).toBeVisible();
  });
});
