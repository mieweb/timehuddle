/**
 * Huddle inbox — the filters in the conversation list header, Group by,
 * search, the "Off the clock" labelling and the inbox's own message box.
 *
 * Posts are seeded through the API (and clock sessions straight into the test
 * DB) so each test controls exactly what the inbox has to group and find; a
 * unique token in every post body keeps tests independent of other data.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  conversationList,
  conversationRows,
  deleteClockSession,
  getUserIdByEmail,
  groupInboxBy,
  inboxComposer,
  inboxMessage,
  inboxSearch,
  openPostInInbox,
  postFromHuddle,
  seedClockSession,
  seedPost,
} from './helpers';

const HOUR = 60 * 60 * 1000;

function uniqueToken(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Today's local calendar date as "YYYY-MM-DD" (same clock as the browser). */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const messageLog = (page: Page) => page.getByRole('log', { name: 'Messages' });

test.describe('Huddle inbox filters', () => {
  test.setTimeout(90000);

  let teamId: string;
  let userId: string;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    teamId = await selectSharedTestTeam(page);
    userId = await getUserIdByEmail(TEST_USERS.owner1.email);
  });

  test('filters sit in the conversation list header and the inbox has its own message box', async ({
    page,
  }) => {
    const token = uniqueToken('layout');
    await seedPost(page, { teamId, text: token });
    await page.goto('/app/huddle');

    const header = conversationList(page);
    await expect(header.getByRole('searchbox', { name: 'Search posts' })).toBeVisible({
      timeout: 20000,
    });
    await expect(header.getByRole('button', { name: /^Team:/ })).toBeVisible();
    await expect(header.getByRole('button', { name: /^Group by:/ })).toBeVisible();
    // Legends notched into each field's border.
    await expect(header.getByText('Team', { exact: true })).toBeVisible();
    await expect(header.getByText('Group by', { exact: true })).toBeVisible();
    // The library's own heading is replaced, and there is only one search box.
    await expect(header.getByText('Conversations', { exact: true })).toBeHidden();
    await expect(inboxSearch(page)).toHaveCount(1);

    // Posting happens in the conversation's own message box, with Pulse and
    // Ticket beside it; there's no separate composer above the inbox any more.
    // Your own posts can still be edited inline.
    await openPostInInbox(page, token);
    await expect(inboxComposer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /Pulse/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ticket', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share an update...' })).toHaveCount(0);
    await inboxMessage(page, token).hover();
    await inboxMessage(page, token).getByRole('button', { name: 'Message actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit message' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Group by defaults to Day, explains each option, and remembers the choice', async ({
    page,
  }) => {
    await seedPost(page, { teamId, text: uniqueToken('group-by') });
    await page.goto('/app/huddle');

    const groupBy = page.getByRole('button', { name: /^Group by:/ });
    await expect(groupBy).toHaveAccessibleName('Group by: Day', { timeout: 20000 });

    await groupBy.click();
    const descriptions = {
      Day: "Everyone's updates, one thread per date",
      Session: 'Each clock-in to clock-out with its plan and wrap-up',
      Person: 'One thread per teammate',
      Ticket: 'Updates grouped by the work item they link to',
    };
    for (const [option, description] of Object.entries(descriptions)) {
      await expect(page.getByRole('menuitem', { name: option })).toContainText(description);
    }
    await page.keyboard.press('Escape');

    await groupInboxBy(page, 'Person');
    await page.reload();
    await expect(page.getByRole('button', { name: /^Group by:/ })).toHaveAccessibleName(
      'Group by: Person',
      { timeout: 20000 },
    );
  });

  test('Session view labels posts made without clocking in; other views stay clean', async ({
    page,
  }) => {
    const token = uniqueToken('off-clock');
    await seedPost(page, { teamId, text: token });
    await page.goto('/app/huddle');

    await groupInboxBy(page, 'Session');
    await openPostInInbox(page, token);
    await expect(conversationRows(page)).toHaveCount(1);
    await expect(conversationRows(page).first()).toContainText('Off the clock');
    await expect(messageLog(page)).toContainText('Posted without clocking in');
    // Said by the thread, never inside the post (its text seeds inline edit).
    await expect(inboxMessage(page, token)).not.toContainText('Off the clock');

    // Other views don't mark it, but search still finds it by that phrase.
    await groupInboxBy(page, 'Day');
    await openPostInInbox(page, `${token} off the clock`, inboxMessage(page, token).first());
    await expect(inboxMessage(page, token)).not.toContainText('Off the clock');
  });

  test('Session view shows a real shift with its clock lines and no off-the-clock label', async ({
    page,
  }) => {
    const token = uniqueToken('shift');
    const startTime = Date.now() - 2 * HOUR;
    const clockEventId = await seedClockSession({
      userId,
      teamId,
      startTime,
      endTime: startTime + HOUR,
    });
    try {
      await seedPost(page, { teamId, text: token, clockEventId });
      await page.goto('/app/huddle');

      await groupInboxBy(page, 'Session');
      await openPostInInbox(page, token);
      const row = conversationRows(page).first();
      await expect(row).toContainText('\u2013'); // start–end span in the title
      await expect(row).not.toContainText('Off the clock');
      await expect(messageLog(page)).toContainText('Clocked in at');
      await expect(messageLog(page)).toContainText('Clocked out at');
      await expect(messageLog(page)).not.toContainText('Posted without clocking in');
    } finally {
      await deleteClockSession(clockEventId);
    }
  });

  test('search matches text, author, labels and dates the same way in every view', async ({
    page,
  }) => {
    const token = uniqueToken('search');
    await seedPost(page, { teamId, text: `${token} quarterly roadmap` });
    await page.goto('/app/huddle');
    await expect(inboxSearch(page)).toBeVisible({ timeout: 20000 });

    const queries = [
      token,
      `${token} ROADMAP`, // case-insensitive, any word of the body
      `${token} Test Owner One`, // author
      `${token} off the clock`, // label
      `${token} ${todayKey()}`, // date
    ];
    for (const option of ['Day', 'Session', 'Person', 'Ticket'] as const) {
      await groupInboxBy(page, option);
      for (const query of queries) {
        await inboxSearch(page).fill(query);
        await expect(conversationRows(page).first(), `${option}: "${query}"`).toBeVisible();
      }
    }

    // Every word must match; the controls stay put while nothing does.
    await inboxSearch(page).fill(`${token} zzqx-nomatch`);
    await expect(conversationRows(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'No matching posts' })).toBeVisible();
    await expect(inboxSearch(page)).toHaveValue(`${token} zzqx-nomatch`);
    await expect(conversationList(page).getByRole('button', { name: /^Group by:/ })).toBeVisible();
  });

  test('a live shift is found by "live" and marked in Session view', async ({ page }) => {
    const token = uniqueToken('live');
    const clockEventId = await seedClockSession({
      userId,
      teamId,
      startTime: Date.now() - 0.5 * HOUR,
      endTime: null,
    });
    try {
      await seedPost(page, { teamId, text: token, clockEventId });
      await page.goto('/app/huddle');

      // "live" comes from the post's session, not its body, so find the message by token.
      await openPostInInbox(page, `${token} live`, inboxMessage(page, token).first());
      await groupInboxBy(page, 'Session');
      await expect(conversationRows(page).first()).toContainText('Live');
    } finally {
      await deleteClockSession(clockEventId);
    }
  });

  test('the Team picker in the list header switches between a team and Personal', async ({
    page,
  }) => {
    const token = uniqueToken('team');
    await seedPost(page, { teamId, text: token });
    await page.goto('/app/huddle');

    await expect(page.getByRole('button', { name: 'Team: Test Team Alpha' })).toBeVisible({
      timeout: 20000,
    });
    // A team feed doesn't repeat its own name on each post.
    await openPostInInbox(page, token);
    await expect(inboxMessage(page, token)).not.toContainText('Test Team Alpha');

    // Personal gathers your posts from every team, each labelled with its team.
    await page.getByRole('button', { name: /^Team:/ }).click();
    await page.getByRole('menuitem', { name: 'Personal', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Team: Personal' })).toBeVisible();
    await openPostInInbox(page, token);
    await expect(inboxMessage(page, token)).toContainText('Test Team Alpha');

    await page.getByRole('button', { name: /^Team:/ }).click();
    await page.getByRole('menuitem', { name: 'Test Team Alpha', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Team: Test Team Alpha' })).toBeVisible();
  });

  test('the message box posts into the feed and clears', async ({ page }) => {
    const token = uniqueToken('share');
    await page.goto('/app/huddle');

    await postFromHuddle(page, token);
    await expect(inboxComposer(page)).toHaveValue('', { timeout: 20000 });
    await openPostInInbox(page, token);
  });
});
