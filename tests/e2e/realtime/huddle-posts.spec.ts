/**
 * Real-time Huddle post synchronization tests.
 *
 * Verifies that huddle posts and comments sync across sessions.
 *
 * Both sessions must be viewing the SAME team feed. Every user has a private
 * "Personal" team that only they see — the app defaults to Personal on first
 * login, so we explicitly switch both sessions to the shared seed team
 * "Test Team Alpha" (TEST01) before asserting cross-session sync.
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';

test.describe('Real-time Huddle Posts', () => {
  let session1: Page;
  let session2: Page;

  async function ensureCardView(page: Page): Promise<void> {
    const switchBtn = page.getByRole('button', { name: 'Switch to card view' });
    if (await switchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await switchBtn.click();
      await page.getByRole('button', { name: 'Switch to chat view' }).waitFor({ timeout: 5000 });
    }
    await page.waitForTimeout(1500);
  }

  test.beforeEach(async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    await loginAs(session1, TEST_USERS.admin1);
    await loginAs(session2, TEST_USERS.admin2);

    // Navigate to Huddle
    await session1.goto('http://localhost:3002/app/huddle');
    await session2.goto('http://localhost:3002/app/huddle');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');

    // Both sessions must view the same team feed for cross-session sync
    // assertions to be meaningful — each user's Personal team is private.
    await selectSharedTestTeam(session1);
    await selectSharedTestTeam(session2);
    await ensureCardView(session1);
    await ensureCardView(session2);
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync new huddle posts across sessions', async () => {
    // Get initial post count in session 1
    const postCards1 = session1.locator('[data-testid="post-card"]');
    const postCards2 = session2.locator('[data-testid="post-card"]');
    const initialCount1 = await postCards1.count();

    // Create a new post in session 1. The composer starts collapsed, and its
    // editing surface is a ProseMirror contenteditable (Kerebron RichEditor),
    // not a <textarea> — a loose `textarea` selector matches the unrelated,
    // disabled "Read-only conversation" message composer instead.
    await session1.getByText('Share an update...').click();
    const postInput = session1.locator('.markdown-editor .ProseMirror').first();

    if ((await postInput.count()) > 0) {
      await postInput.fill('Test real-time sync post');

      const postButton = session1.getByRole('button', { name: 'Post', exact: true });
      if ((await postButton.count()) > 0) {
        await postButton.click();

        // Session 1 should show the new post
        await expect
          .poll(async () => postCards1.count(), { timeout: 15000 })
          .toBeGreaterThan(initialCount1);
        const newCount1 = await postCards1.count();

        // Session 2 should automatically show the new post
        await expect.poll(async () => postCards2.count(), { timeout: 15000 }).toBe(newCount1);
      }
    }
  });

  test('should show same post count in both sessions', async () => {
    await session1.waitForTimeout(1000);
    await session2.waitForTimeout(1000);

    const postCount1 = await session1.locator('[data-testid="post-card"]').count();
    const postCount2 = await session2.locator('[data-testid="post-card"]').count();

    expect(postCount1).toBe(postCount2);
  });
});
