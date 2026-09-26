/**
 * What the push dialog does with the server's answer (plan area a, results half).
 *
 * `push-panel.spec.ts` covers the offer and its gating; this file starts where
 * the Send click lands. The cases that matter are the unhappy ones: a partial
 * failure must leave the successes visible and name each failure in words, a
 * push that sent everything must still show its results, and a double click
 * must not send twice — entries are create-only (D1), so a duplicate is
 * permanent.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`).
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import {
  activityList,
  connectedStatus,
  delayed,
  preview,
  previewRow,
  pushOutcome,
  pushResult,
  stubRedmine,
  type RedmineStub,
  type StubValue,
} from '../fixtures/redmine';

const sendButton = (page: Page) =>
  page.getByRole('button', { name: 'Send work entries to Redmine' });
const entriesTable = (page: Page) =>
  page.getByRole('table', { name: 'Time entries to send to Redmine' });
const confirmButton = (page: Page) => page.getByRole('button', { name: /^Send \d+ entr/ });
const rowFor = (page: Page, ticketId: string) =>
  entriesTable(page)
    .locator('tbody tr')
    .filter({ hasText: `#${ticketId}` });

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

/** Opens the dialog and sends, leaving the results on screen. */
async function sendAll(page: Page): Promise<void> {
  await sendButton(page).click();
  await confirmButton(page).click();
}

const TWO_ROWS = [previewRow({ ticketId: '15' }), previewRow({ ticketId: '23' })];

test.describe('Redmine push results', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await new ClockPage(page).ensureClockedOut();
  });

  test('a successful push reports each row as Sent', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': (_p, i) => preview({ rows: i === 0 ? TWO_ROWS : [] }),
      'timeEntries.push': () =>
        pushResult(pushOutcome({ ticketId: '15' }), pushOutcome({ ticketId: '23' })),
    });

    await sendAll(page);

    await expect(page.getByRole('heading', { name: 'Sent to Redmine' })).toBeVisible({
      timeout: 15000,
    });
    await expect(rowFor(page, '15')).toContainText('Sent');
    await expect(rowFor(page, '23')).toContainText('Sent');
  });

  test('a push that sent everything still shows its results', async ({ page }) => {
    // Regression guard: the results are rendered from a snapshot taken at click
    // time, because the reloaded preview is empty once everything has been sent
    // — reading from it used to unmount the dialog before it could be read.
    await openClock(page, {
      'timeEntries.preview': (_p, i) => preview({ rows: i === 0 ? TWO_ROWS : [] }),
      'timeEntries.push': () =>
        pushResult(pushOutcome({ ticketId: '15' }), pushOutcome({ ticketId: '23' })),
    });

    await sendAll(page);

    await expect(entriesTable(page)).toBeVisible({ timeout: 15000 });
    await expect(entriesTable(page).locator('tbody tr')).toHaveCount(2);
  });

  test('a partial failure keeps the successful row synced and names the failure', async ({
    page,
  }) => {
    await openClock(page, {
      'timeEntries.preview': (_p, i) =>
        preview({ rows: i === 0 ? TWO_ROWS : [previewRow({ ticketId: '23' })] }),
      'timeEntries.push': () =>
        pushResult(
          pushOutcome({ ticketId: '15' }),
          pushOutcome({ ticketId: '23', ok: false, reason: 'no-log-time-permission' }),
        ),
    });

    await sendAll(page);

    await expect(rowFor(page, '15')).toContainText('Sent');
    await expect(rowFor(page, '23')).toContainText('Your Redmine role is missing “Log spent time”');
    // Never the raw code.
    await expect(rowFor(page, '23')).not.toContainText('no-log-time-permission');
  });

  for (const [reason, sentence] of [
    ['rejected-by-redmine', 'Redmine rejected the entry'],
    ['unreachable', 'Could not reach Redmine'],
    ['hours-mismatch', 'Redmine stored different hours than we sent'],
    ['no-entry-id', 'Redmine did not return an entry id'],
    ['already-synced-or-gone', 'Already sent, or no longer eligible'],
    ['invalid-activity', 'That activity no longer exists in Redmine'],
  ] as const) {
    test(`explains "${reason}" in words`, async ({ page }) => {
      await openClock(page, {
        'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15' })] }),
        'timeEntries.push': () => pushResult(pushOutcome({ ticketId: '15', ok: false, reason })),
      });

      await sendAll(page);

      await expect(rowFor(page, '15')).toContainText(sentence, { timeout: 15000 });
      await expect(rowFor(page, '15')).not.toContainText(reason);
    });
  }

  test('a row the server said nothing about reads "Not sent"', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({ rows: TWO_ROWS }),
      // Only the first row comes back — the second is simply absent.
      'timeEntries.push': () => pushResult(pushOutcome({ ticketId: '15' })),
    });

    await sendAll(page);

    await expect(rowFor(page, '15')).toContainText('Sent');
    await expect(rowFor(page, '23')).toContainText('Not sent');
  });

  test('a double click sends once, and the button says so meanwhile', async ({ page }) => {
    // Deliberately delayed rather than racing real latency: entries are
    // create-only, so a second send would be a permanent duplicate.
    const rm = await openClock(page, {
      'timeEntries.preview': (_p, i) => preview({ rows: i === 0 ? TWO_ROWS : [] }),
      'timeEntries.push': delayed(
        1200,
        pushResult(pushOutcome({ ticketId: '15' }), pushOutcome({ ticketId: '23' })),
      ),
    });

    await sendButton(page).click();
    const confirm = confirmButton(page);
    await confirm.click();
    await expect(page.getByRole('button', { name: /Sending/ })).toBeVisible();
    await page
      .getByRole('button', { name: /Sending/ })
      .click({ force: true })
      .catch(() => {});

    await expect(page.getByRole('heading', { name: 'Sent to Redmine' })).toBeVisible({
      timeout: 20000,
    });
    expect(rm.callCount('timeEntries.push')).toBe(1);
  });

  test('a transport failure keeps the dialog open with its rows intact', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({ rows: TWO_ROWS }),
      'timeEntries.push': { status: 500, reason: 'Could not send time to Redmine.' },
    });

    await sendAll(page);

    await expect(page.getByText('Could not send time to Redmine.')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('heading', { name: 'Sent to Redmine' })).toHaveCount(0);
    await expect(entriesTable(page).locator('tbody tr')).toHaveCount(2);
  });

  test('an aborted request is reported, not swallowed', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15' })] }),
      'timeEntries.push': 'abort',
    });

    await sendAll(page);

    await expect(page.getByRole('heading', { name: 'Sent to Redmine' })).toHaveCount(0);
    await expect(entriesTable(page)).toBeVisible();
  });

  test('closing after a push clears the results', async ({ page }) => {
    await openClock(page, {
      'timeEntries.preview': (_p, i) =>
        preview({ rows: i === 0 ? TWO_ROWS : [previewRow({ ticketId: '23' })] }),
      'timeEntries.push': () =>
        pushResult(
          pushOutcome({ ticketId: '15' }),
          pushOutcome({ ticketId: '23', ok: false, reason: 'unreachable' }),
        ),
    });

    await sendAll(page);
    await expect(page.getByRole('heading', { name: 'Sent to Redmine' })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Close' }).click();

    // Reopening offers the still-eligible row afresh, with no stale verdicts.
    await sendButton(page).click();
    await expect(page.getByRole('heading', { name: 'Send work entries to Redmine' })).toBeVisible();
    await expect(entriesTable(page)).not.toContainText('Could not reach Redmine');
  });
});
