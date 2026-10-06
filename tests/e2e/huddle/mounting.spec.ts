/**
 * Huddle stays mounted and loads by date window (#635).
 *
 * Leaving Huddle for another page and coming back must not rebuild the inbox
 * (no spinner, no empty "Today", same conversation open). The feed reads the
 * last 30 days, then widens by 30 each time the end of the conversation list
 * is seen.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  deletePost,
  getUserIdByEmail,
  inboxMessage,
  inboxComposer,
  inboxSearch,
  conversationRows,
  openPostInInbox,
  seedPost,
  seedPostDaysAgo,
} from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueToken(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** "YYYY-MM-DD" for the local calendar day `offset` days from today. */
function dateKey(offset = 0): string {
  const d = new Date(Date.now() + offset * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How the inbox titles a Day conversation, e.g. "Tue, Oct 6". */
function dayLabel(offset = 0): string {
  return new Date(Date.now() + offset * DAY_MS).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

async function openFromSidebar(page: Page, name: RegExp) {
  await page.getByRole('button', { name }).first().click();
}

test.describe('Huddle stays mounted', () => {
  test.setTimeout(90000);

  let teamId: string;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    teamId = await selectSharedTestTeam(page);
  });

  test('coming back from another page shows the same conversation, with no reload', async ({
    page,
  }) => {
    const token = uniqueToken('mounted');
    await seedPost(page, { teamId, text: token, postDate: dateKey(-1) });
    await page.goto('/app/huddle');
    await openPostInInbox(page, token);
    const openedUrl = new URL(page.url());
    const conversation = openedUrl.searchParams.get('conversation');
    expect(conversation).toBeTruthy();

    await openFromSidebar(page, /^Tickets$/i);
    await expect(page).toHaveURL(/\/app\/tickets/);
    await openFromSidebar(page, /^Huddle$/i);

    // Straight back: nothing is loading, nothing is rebuilt, and the view the
    // sidebar link didn't carry (conversation and search) is restored.
    await expect(inboxMessage(page, token)).toBeVisible({ timeout: 1500 });
    await expect(page.getByRole('status', { name: 'Loading posts' })).toHaveCount(0);
    await expect(page.getByText('No updates yet', { exact: false })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`conversation=${encodeURIComponent(conversation!)}`));
    await expect(inboxSearch(page)).toHaveValue(token);
  });

  test('a link that names a conversation wins over the remembered one', async ({ page }) => {
    const token = uniqueToken('link-wins');
    const postId = await seedPost(page, { teamId, text: token });
    await page.goto('/app/huddle');
    await openPostInInbox(page, token);

    await openFromSidebar(page, /^Tickets$/i);
    await expect(page).toHaveURL(/\/app\/tickets/);
    // An in-app navigation to a post link, as a notification tap performs.
    await page.evaluate((id) => {
      window.history.pushState(null, '', `/app/huddle?post=${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, postId);

    await expect(inboxMessage(page, token).first()).toBeVisible({ timeout: 15000 });
    await expect(page).not.toHaveURL(/[?&]post=/);
  });

  test('the conversation list keeps its scroll position across a visit elsewhere', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const postIds: string[] = [];
    try {
      for (let daysBack = 1; daysBack <= 25; daysBack++) {
        postIds.push(
          await seedPost(page, {
            teamId,
            text: uniqueToken(`scroll-${daysBack}`),
            postDate: dateKey(-daysBack),
          }),
        );
      }
      await page.goto('/app/huddle');
      const list = page.locator('[data-slot="superchat-conversation-list"]');
      await expect(conversationRows(page).nth(15)).toBeAttached({ timeout: 20000 });
      await list.evaluate((el) => {
        el.scrollTop = 300;
      });
      const before = await list.evaluate((el) => el.scrollTop);
      expect(before).toBeGreaterThan(0);

      await openFromSidebar(page, /^Tickets$/i);
      await expect(page).toHaveURL(/\/app\/tickets/);
      await openFromSidebar(page, /^Huddle$/i);

      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(before);
    } finally {
      for (const id of postIds) await deletePost(id);
    }
  });

  test('on a phone a first visit lands in the Today chat, not the list', async ({ page }) => {
    await seedPost(page, { teamId, text: uniqueToken('phone'), postDate: dateKey(-1) });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/app/huddle');
    await expect(page.getByRole('group', { name: `Chat: ${dayLabel()}` })).toBeVisible({
      timeout: 20000,
    });
    await expect(inboxComposer(page)).toBeVisible();
    await expect(conversationRows(page).first()).toBeHidden();
  });

  test('a first visit opens Today in Day grouping', async ({ page }) => {
    await seedPost(page, { teamId, text: uniqueToken('today'), postDate: dateKey(-1) });
    await page.goto('/app/huddle');
    await expect(page.getByRole('group', { name: `Chat: ${dayLabel()}` })).toBeVisible({
      timeout: 20000,
    });
  });

  test('loads 30 days, then the previous 30 when the end of the list is seen', async ({ page }) => {
    const token = uniqueToken('old');
    const userId = await getUserIdByEmail(TEST_USERS.owner1.email);
    const oldPostId = await seedPostDaysAgo({ teamId, userId, text: token, daysAgo: 45 });
    try {
      const sinces: number[] = [];
      page.on('request', (request) => {
        if (!request.url().includes('/api/huddle_getPosts')) return;
        const since = request.postDataJSON()?.since;
        if (since) sinces.push(Date.parse(since));
      });

      await page.goto('/app/huddle');
      await expect(conversationRows(page).first()).toBeVisible({ timeout: 20000 });

      // The first window is the last 30 days (counted from local midnight).
      await expect.poll(() => sinces.length, { timeout: 15000 }).toBeGreaterThan(0);
      expect((Date.now() - sinces[0]) / DAY_MS).toBeGreaterThanOrEqual(30);
      expect((Date.now() - sinces[0]) / DAY_MS).toBeLessThan(31.5);

      // The list is short, so its end is on screen: the next 30 days load by themselves.
      await expect.poll(() => sinces.length, { timeout: 15000 }).toBeGreaterThan(1);
      expect((Date.now() - sinces[1]) / DAY_MS).toBeGreaterThanOrEqual(60);

      await inboxSearch(page).fill(token);
      await expect(conversationRows(page).first()).toBeVisible({ timeout: 15000 });
      await inboxSearch(page).fill('');
      await expect(page.getByText('No older posts')).toBeVisible({ timeout: 20000 });
    } finally {
      await deletePost(oldPostId);
    }
  });
});
