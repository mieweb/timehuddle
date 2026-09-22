/**
 * The Redmine push panel on the Clock page and its gating (plan area a).
 *
 * The panel is the riskiest surface in the integration: what it sends becomes a
 * permanent Redmine time entry that nothing in TimeHuddle can edit or delete
 * (D1). So the assertions here are about *what would be sent* and *when sending
 * is refused*, not only about what the page looks like.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`). That
 * deliberately means the server's ticket-day aggregation, the
 * `alreadySentSeconds` ledger and the `too-short` rule are **never** exercised
 * here — those are unit-tested on the Meteor side and must stay there. A green
 * run of this file is not evidence that the integration works end to end.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import {
  activityList,
  connectedStatus,
  preview,
  previewRow,
  pushOutcome,
  pushResult,
  stubRedmine,
  today,
  type RedmineStub,
  type StubValue,
} from '../fixtures/redmine';

const sendButton = (page: Page) =>
  page.getByRole('button', { name: 'Send work entries to Redmine' });
const summary = (page: Page) => page.locator('.redmine-push-summary [aria-live="polite"]');
const entriesTable = (page: Page) =>
  page.getByRole('table', { name: 'Time entries to send to Redmine' });
const confirmButton = (page: Page) => page.getByRole('button', { name: /^Send \d+ entr/ });

async function openClock(page: Page, overrides: Record<string, StubValue>): Promise<RedmineStub> {
  const rm = await stubRedmine(page, {
    status: connectedStatus(),
    'activities.list': activityList(),
    ...overrides,
  });
  await page.goto('/app/clock');
  await expect(page.getByRole('heading', { level: 1, name: /Clock/i })).toBeVisible({
    timeout: 20000,
  });
  return rm;
}

test.describe('Redmine push panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    // The idle gate reads the live clock state, so start from a known one.
    await new ClockPage(page).ensureClockedOut();
  });

  test('summarises what is ready to send', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({
        rows: [
          previewRow({ ticketId: '15', seconds: 2232 }), // 0:37
          previewRow({ ticketId: '23', seconds: 1800 }), // 0:30
        ],
      }),
    });

    await expect(summary(page)).toHaveText(/2 ticket-days · 1:07/);
    await expect(sendButton(page)).toBeEnabled();
  });

  test('lists the rows it would send, with issue, date and hours', async ({ page }) => {
    const date = today();
    await openClock(page, {
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15', seconds: 2232 })] }),
    });

    await sendButton(page).click();

    await expect(page.getByRole('heading', { name: 'Send work entries to Redmine' })).toBeVisible();
    const row = entriesTable(page).locator('tbody tr').first();
    await expect(row).toContainText('#15');
    await expect(row).toContainText('Fix the intake form validation');
    await expect(row).toContainText(date);
    await expect(row).toContainText('0:37');
  });

  test('warns that the entries are permanent', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({ rows: [previewRow()] }),
    });

    await sendButton(page).click();

    await expect(
      page.getByText('They cannot be edited or deleted', { exact: false }),
    ).toBeVisible();
  });

  test('does not appear at all when Redmine is not connected', async ({ page }) => {
    await openClock(page, {
      status: { connected: false },
      'timeEntries.preview': { connected: false, idle: true, rows: [], baseUrl: null },
    });

    await expect(page.getByText('Redmine time ready to send')).toHaveCount(0);
  });

  test('does not appear when there is nothing to send', async ({ page }) => {
    await openClock(page, { 'timeEntries.preview': preview({ rows: [] }) });

    await expect(page.getByText('Redmine time ready to send')).toHaveCount(0);
  });

  test('refuses to send while the shift is still open', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({ idle: false, rows: [previewRow()] }),
    });

    await expect(sendButton(page)).toBeDisabled();
    await expect(summary(page)).toContainText('clock out and stop all timers first');
    await expect(sendButton(page)).toHaveAttribute(
      'title',
      'Clock out and stop every ticket timer before sending time to Redmine',
    );
  });

  test('shows blocked rows rather than hiding them, with the reason', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({
        rows: [
          previewRow({ ticketId: '15' }),
          previewRow({
            ticketId: '99',
            subject: null,
            issueMissing: true,
            blockedReason: 'issue-unavailable',
          }),
        ],
      }),
    });

    await expect(summary(page)).toContainText('1 can’t be sent');
    await sendButton(page).click();

    const blockedRow = entriesTable(page).locator('tbody tr').filter({ hasText: '#99' });
    await expect(blockedRow).toContainText('Unavailable');
    await expect(blockedRow).toContainText('Issue could not be loaded from Redmine');
    // A blocked row offers no activity to choose — there is nothing to send.
    await expect(blockedRow.getByRole('combobox')).toHaveCount(0);
  });

  test('a row with no resolvable activity is blocked and says so', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({
        rows: [
          previewRow({ ticketId: '15' }),
          previewRow({
            ticketId: '42',
            activityId: null,
            activityName: null,
            blockedReason: 'no-activity',
          }),
        ],
      }),
    });

    await sendButton(page).click();

    await expect(entriesTable(page).locator('tbody tr').filter({ hasText: '#42' })).toContainText(
      'No activity could be resolved',
    );
  });

  test('sub-minute time is withheld entirely — no row, no block, no panel', async ({ page }) => {
    // `too-short` rows are not worth a Redmine entry and must not summon the
    // panel or be counted among the blocked ones.
    await openClock(page, {
      'timeEntries.preview': preview({
        rows: [previewRow({ ticketId: '15', seconds: 30, blockedReason: 'too-short' })],
      }),
    });

    await expect(page.getByText('Redmine time ready to send')).toHaveCount(0);
  });

  test('a blocked-only preview shows the panel but refuses to send', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({
        rows: [previewRow({ ticketId: '99', blockedReason: 'issue-unavailable', subject: null })],
      }),
    });

    await expect(summary(page)).toContainText('0 ticket-days');
    await expect(summary(page)).toContainText('1 can’t be sent');
    await expect(sendButton(page)).toBeDisabled();
  });

  test('already-pushed time reappears as unsent time only (D5)', async ({ page }) => {
    // The bug found by hand: more work on a ticket-day that was already pushed
    // must come back as a delta, not vanish because the day "was sent".
    await openClock(page, {
      'timeEntries.preview': preview({
        rows: [previewRow({ ticketId: '15', seconds: 900, alreadySentSeconds: 2232 })],
      }),
    });

    await sendButton(page).click();

    const row = entriesTable(page).locator('tbody tr').first();
    await expect(row).toContainText('0:15');
    await expect(row).toContainText('new time only · 0:37 already sent');
  });

  test('an activity override travels in the pushed body', async ({ page }) => {
    const date = today();
    const rm = await openClock(page, {
      'timeEntries.preview': preview({
        rows: [previewRow({ ticketId: '15', activityId: 9, activityName: 'Development' })],
      }),
      'timeEntries.push': () => pushResult(pushOutcome({ ticketId: '15' })),
    });

    await sendButton(page).click();
    await page.getByRole('combobox', { name: `Activity for issue 15 on ${date}` }).click();
    await page.getByRole('option', { name: 'QA', exact: true }).click();
    await confirmButton(page).click();

    await expect.poll(() => rm.callCount('timeEntries.push')).toBe(1);
    // The panel always sends the resolved activity, so assert the *changed* id.
    expect(rm.calls('timeEntries.push')[0]).toEqual({
      entries: [{ ticketId: '15', date, activityId: 10 }],
    });
  });

  test('cancelling discards any overrides', async ({ page }) => {
    const date = today();
    await openClock(page, {
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15', activityId: 9 })] }),
    });

    await sendButton(page).click();
    const activity = page.getByRole('combobox', { name: `Activity for issue 15 on ${date}` });
    await activity.click();
    await page.getByRole('option', { name: 'QA', exact: true }).click();
    await expect(activity).toHaveText('QA');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await sendButton(page).click();

    await expect(
      page.getByRole('combobox', { name: `Activity for issue 15 on ${date}` }),
    ).toHaveText('Development');
  });

  test('sends only the ticket-days it listed', async ({ page }) => {
    const date = today();
    const rm = await openClock(page, {
      'timeEntries.preview': preview({
        rows: [
          previewRow({ ticketId: '15' }),
          previewRow({ ticketId: '23' }),
          previewRow({ ticketId: '99', blockedReason: 'issue-unavailable', subject: null }),
        ],
      }),
      'timeEntries.push': () =>
        pushResult(pushOutcome({ ticketId: '15' }), pushOutcome({ ticketId: '23' })),
    });

    await sendButton(page).click();
    await confirmButton(page).click();

    await expect.poll(() => rm.callCount('timeEntries.push')).toBe(1);
    const sent = rm.calls('timeEntries.push')[0] as { entries: { ticketId: string }[] };
    expect(sent.entries.map((e) => e.ticketId)).toEqual(['15', '23']);
    expect(sent.entries).toHaveLength(2);
    expect(date).toBe(today());
  });
});
