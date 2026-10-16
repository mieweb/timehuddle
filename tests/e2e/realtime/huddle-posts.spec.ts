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
import { openPostInInbox, postFromHuddle, seedPost } from '../huddle/helpers';

test.describe('Real-time Huddle Posts', () => {
  let session1: Page;
  let session2: Page;
  let teamId: string;

  const conversations = (page: Page) =>
    page.locator('[data-slot="superchat-conversation-list"] [role="listitem"]');

  test.beforeEach(async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    await loginAs(session1, TEST_USERS.admin1);
    await loginAs(session2, TEST_USERS.admin2);

    // Both sessions must view the same team feed for cross-session sync
    // assertions to be meaningful — each user's Personal team is private.
    teamId = await selectSharedTestTeam(session1);
    await selectSharedTestTeam(session2);

    await session1.goto('/app/huddle');
    await session2.goto('/app/huddle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync new huddle posts across sessions', async () => {
    const text = `Test real-time sync post ${Date.now()}`;
    await postFromHuddle(session1, text);

    // Session 1 finds its own post in the feed…
    await openPostInInbox(session1, text);
    // …and session 2 picks it up without a reload.
    await openPostInInbox(session2, text);
  });

  test('should show same conversation count in both sessions', async () => {
    // Seed a post and wait for a row on both sides — two still-loading, empty
    // feeds would otherwise pass as 0 === 0. Seeded through the API so neither
    // page's grouping or search changes; the counts are only comparable if
    // both pages show the same view.
    await seedPost(session1, { teamId, text: `Conversation count seed ${Date.now()}` });
    await expect(conversations(session1).first()).toBeVisible({ timeout: 15000 });
    await expect(conversations(session2).first()).toBeVisible({ timeout: 15000 });

    await expect
      .poll(
        async () =>
          (await conversations(session1).count()) === (await conversations(session2).count()),
        {
          timeout: 15000,
        },
      )
      .toBe(true);
  });
});
