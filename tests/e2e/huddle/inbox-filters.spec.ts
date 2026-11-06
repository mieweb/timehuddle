/**
 * Huddle inbox — the filters in the conversation list header, Group by,
 * search, which posts the Session view holds, and the inbox's own message box.
 *
 * Posts are seeded through the API (and clock sessions straight into the test
 * DB) so each test controls exactly what the inbox has to group and find; a
 * unique token in every post body keeps tests independent of other data.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTestTeam, selectSharedTestTeam } from '../fixtures/team';
import {
  conversationList,
  conversationRows,
  deleteClockSession,
  getUserIdByEmail,
  groupInboxBy,
  insertPost,
  inboxComposer,
  inboxMessage,
  inboxSearch,
  openPostInInbox,
  postFromHuddle,
  seedClockSession,
  deletePost,
  seedPost,
  seedPostDaysAgo,
} from './helpers';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
      All: 'Every update in one thread, oldest first',
      Day: "Everyone's updates, one thread per date",
      Session: 'Each clock-in to clock-out with its plan, updates and wrap-up',
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

  test('All puts every day in one thread, dated, and search narrows the posts in it', async ({
    page,
  }) => {
    const token = uniqueToken('all-view');
    const oldText = `${token} older`;
    const newText = `${token} newer`;
    await seedPostDaysAgo({ teamId, userId, text: oldText, daysAgo: 3 });
    await seedPost(page, { teamId, text: newText });
    await page.goto('/app/huddle');

    await groupInboxBy(page, 'All');
    await expect(conversationRows(page)).toHaveCount(1);

    await inboxSearch(page).fill(token);
    await expect(inboxMessage(page, oldText)).toBeVisible({ timeout: 20000 });
    await expect(inboxMessage(page, newText)).toBeVisible();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * HOUR).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    await expect(messageLog(page).getByText(threeDaysAgo, { exact: true })).toBeVisible();

    await inboxSearch(page).fill(oldText);
    await expect(inboxMessage(page, oldText)).toBeVisible();
    await expect(inboxMessage(page, newText)).toHaveCount(0);

    await inboxSearch(page).fill('');
    await page.reload();
    await expect(page.getByRole('button', { name: /^Group by:/ })).toHaveAccessibleName(
      'Group by: All',
      { timeout: 20000 },
    );
  });

  test('with All saved, a post link opens its session with the post in view', async ({ page }) => {
    const token = uniqueToken('all-link');
    const startTime = Date.now() - 2 * DAY;
    const clockEventId = await seedClockSession({
      userId,
      teamId,
      startTime,
      endTime: startTime + HOUR,
    });
    const linkedId = await insertPost({
      teamId,
      userId,
      text: token,
      createdAt: startTime + 1000,
      clockEventId,
    });
    // Enough newer posts that the linked one would be offscreen in the All
    // thread. Dated yesterday, so they stay out of today's threads other tests read.
    const newerIds: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      newerIds.push(
        await seedPostDaysAgo({ teamId, userId, text: `${token} newer ${i}`, daysAgo: 1 }),
      );
    }
    try {
      await page.goto('/app/huddle');
      await groupInboxBy(page, 'All');

      await page.goto(`/app/huddle?post=${linkedId}`);
      await expect(page).toHaveURL(/conversation=session%3A/, { timeout: 30000 });
      await expect(inboxMessage(page, token).first()).toBeInViewport();
      await expect(page.getByRole('button', { name: /^Group by:/ })).toHaveAccessibleName(
        'Group by: Session',
      );

      // The saved grouping is still All.
      await page.goto('/app/huddle');
      await expect(page.getByRole('button', { name: /^Group by:/ })).toHaveAccessibleName(
        'Group by: All',
        { timeout: 20000 },
      );
    } finally {
      await Promise.all([linkedId, ...newerIds].map((id) => deletePost(id)));
      await deleteClockSession(clockEventId);
    }
  });

  test('a link to a post made off the clock opens its Day thread', async ({ page }) => {
    const token = uniqueToken('off-clock-link');
    const linkedId = await seedPostDaysAgo({ teamId, userId, text: token, daysAgo: 2 });
    try {
      await page.goto('/app/huddle');
      await groupInboxBy(page, 'Session');

      await page.goto(`/app/huddle?post=${linkedId}`);
      await expect(page).toHaveURL(/conversation=day%3A/, { timeout: 30000 });
      await expect(inboxMessage(page, token).first()).toBeVisible();
      await expect(page.getByText('Post not found', { exact: false })).toHaveCount(0);
    } finally {
      await deletePost(linkedId);
    }
  });

  test('Session view leaves out posts made without clocking in; All and Day keep them', async ({
    page,
  }) => {
    const token = uniqueToken('off-clock');
    await seedPost(page, { teamId, text: token });
    await page.goto('/app/huddle');

    await groupInboxBy(page, 'Session');
    await inboxSearch(page).fill(token);
    await expect(conversationRows(page)).toHaveCount(0);
    await inboxSearch(page).fill('');

    for (const grouping of ['All', 'Day'] as const) {
      await groupInboxBy(page, grouping);
      await openPostInInbox(page, token);
      // Search still finds it by that phrase.
      await openPostInInbox(page, `${token} off the clock`, inboxMessage(page, token).first());
      await expect(inboxMessage(page, token)).not.toContainText('Off the clock');
    }
  });

  test('a grouping picked while a post sends is kept when it lands (#854)', async ({ page }) => {
    const olderToken = uniqueToken('older-shift');
    const token = uniqueToken('in-flight');
    const olderStart = Date.now() - 3 * HOUR;
    const olderShift = await seedClockSession({
      userId,
      teamId,
      startTime: olderStart,
      endTime: olderStart + HOUR,
    });
    const liveShift = await seedClockSession({
      userId,
      teamId,
      startTime: Date.now() - HOUR,
      endTime: null,
    });
    let release = () => {};
    try {
      await seedPost(page, { teamId, text: olderToken, clockEventId: olderShift });
      await page.goto('/app/huddle');
      await groupInboxBy(page, 'Session');
      // Sent from an older shift's thread, so it has somewhere else to land.
      await openPostInInbox(page, olderToken);
      await inboxSearch(page).fill('');

      // Hold the create until the grouping has changed. Sent from Session while
      // clocked in, it would otherwise land in (and switch back to) the live shift.
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/api/huddle_createPost', async (route) => {
        await held;
        await route.continue();
      });
      await postFromHuddle(page, token);
      await groupInboxBy(page, 'Person');
      release();

      await expect(inboxMessage(page, token).first()).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(2000); // past the post's own feed refresh
      await expect(page.getByRole('button', { name: /^Group by:/ })).toHaveAccessibleName(
        'Group by: Person',
      );
    } finally {
      release();
      await page.unroute('**/api/huddle_createPost');
      await Promise.all([olderShift, liveShift].map((id) => deleteClockSession(id)));
    }
  });

  test('Session with only off-the-clock posts still has a message box (#854)', async ({ page }) => {
    // A team of its own, so no other test's shifts are in its Session view.
    await createTestTeam(page, 'EmptySession');
    const first = uniqueToken('before-shift');
    const second = uniqueToken('from-session');
    await page.goto('/app/huddle');
    await groupInboxBy(page, 'Day');
    await postFromHuddle(page, first);
    await expect(inboxMessage(page, first)).toBeVisible({ timeout: 20000 });

    await groupInboxBy(page, 'Session');
    await expect(messageLog(page)).toContainText('No shifts yet');
    await expect(inboxComposer(page)).toBeVisible();

    // Clocked out, so it lands in today's Day thread, which opens.
    await postFromHuddle(page, second);
    await expect(page).toHaveURL(/conversation=day%3A/, { timeout: 20000 });
    await expect(inboxMessage(page, second)).toBeVisible();
    await expect(inboxMessage(page, first)).toBeVisible();
  });

  test('a post sent from Huddle while clocked in joins the live session', async ({ page }) => {
    const planToken = uniqueToken('plan');
    const token = uniqueToken('mid-shift');
    const clockEventId = await seedClockSession({
      userId,
      teamId,
      startTime: Date.now() - HOUR,
      endTime: null,
    });
    try {
      await seedPost(page, { teamId, text: planToken, clockEventId });
      await page.goto('/app/huddle');
      await groupInboxBy(page, 'Session');
      await openPostInInbox(page, planToken);
      await inboxSearch(page).fill('');

      await postFromHuddle(page, token);
      await expect(inboxMessage(page, token)).toBeVisible({ timeout: 20000 });
      // Same thread as the plan: the live shift, not a thread of its own.
      await expect(inboxMessage(page, planToken)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`conversation=session%3A${clockEventId}`));
      await expect(conversationList(page)).not.toContainText('Off the clock');
    } finally {
      await deleteClockSession(clockEventId);
    }
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
      await expect(messageLog(page)).toContainText('You clocked in');
      await expect(messageLog(page)).toContainText('You clocked out');
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
    // Not Session: the post is made off the clock, so Session leaves it out.
    for (const option of ['Day', 'Person', 'Ticket'] as const) {
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
