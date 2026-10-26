/**
 * Scheduled Huddle posts (#596), end to end: one author, one teammate.
 *
 * Both sessions must be viewing the SAME team feed — see huddle-posts.spec.ts
 * for why. Delivery is driven through the composer's own "Send now" action
 * (same `huddle.sendScheduledNow` the Scheduled Posts panel calls in the real
 * app), not by waiting out the real Agenda job — the Agenda/change-stream
 * delivery path itself is covered at the backend level
 * (meteor-backend/tests/huddle-scheduled-posts.test.ts), so this spec's job is
 * the part only a browser can exercise: the schedule dialog, the hidden state
 * across two live sessions, and the live (DDP) handoff once it's sent.
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { inboxComposer, inboxMessage, openPostInInbox } from '../huddle/helpers';

test.describe('Scheduled Huddle Posts', () => {
  let session1: Page;
  let session2: Page;

  test.beforeEach(async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    await loginAs(session1, TEST_USERS.admin1);
    await loginAs(session2, TEST_USERS.admin2);

    await selectSharedTestTeam(session1);
    await selectSharedTestTeam(session2);

    await session1.goto('/app/huddle');
    await session2.goto('/app/huddle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  /** Fill the inbox composer and send it through "Send later…" with the first quick pick. */
  async function scheduleFromInbox(page: Page, text: string) {
    await inboxComposer(page).fill(text);
    await page.getByRole('button', { name: 'More send options' }).click();
    await page.getByRole('menuitem', { name: 'Send later…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Schedule Post' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'In 1 hour' }).click();
    await dialog.getByRole('button', { name: 'Schedule' }).click();
    await expect(dialog).not.toBeVisible();
  }

  /** The composer's "Scheduled (n)" chip — its accessible name is "n scheduled post(s)". */
  function scheduledChip(page: Page, count: number) {
    return page.getByRole('button', { name: `${count} scheduled post${count === 1 ? '' : 's'}` });
  }

  test('keeps a scheduled post hidden from a teammate, then delivers it live on Send now', async () => {
    const text = `Scheduled e2e post ${Date.now()}`;

    await scheduleFromInbox(session1, text);

    // The author sees their own post right away, as a pending bubble — the
    // chip is the unambiguous signal something is scheduled.
    await expect(scheduledChip(session1, 1)).toBeVisible();
    await openPostInInbox(session1, text);

    // The teammate must never see it (or be told about it) before delivery.
    await session2.getByRole('searchbox', { name: 'Search posts' }).fill(text);
    await session2.waitForTimeout(2000); // give a live update a chance to (wrongly) arrive
    await expect(inboxMessage(session2, text)).toHaveCount(0);

    // Send now — the same path the Scheduled Posts panel's own button calls.
    await scheduledChip(session1, 1).click();
    const sheet = session1.getByRole('dialog', { name: 'Scheduled Posts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(text)).toBeVisible();
    await sheet.getByRole('button', { name: 'Send now' }).click();

    // The chip disappears once nothing is pending anymore.
    await expect(scheduledChip(session1, 1)).not.toBeVisible();

    // The teammate picks it up live, without reloading.
    await openPostInInbox(session2, text);
  });

  test('lets the author delete a still-pending scheduled post, and the teammate never sees it', async () => {
    const text = `Deleted before delivery ${Date.now()}`;

    await scheduleFromInbox(session1, text);
    await expect(scheduledChip(session1, 1)).toBeVisible();

    await scheduledChip(session1, 1).click();
    const sheet = session1.getByRole('dialog', { name: 'Scheduled Posts' });
    await sheet.getByRole('button', { name: 'Delete' }).click();

    const confirm = session1.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    await expect(scheduledChip(session1, 1)).not.toBeVisible();

    await session2.getByRole('searchbox', { name: 'Search posts' }).fill(text);
    await session2.waitForTimeout(2000);
    await expect(inboxMessage(session2, text)).toHaveCount(0);
  });
});
