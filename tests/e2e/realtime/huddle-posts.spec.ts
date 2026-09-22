/**
 * Real-time Huddle post synchronization.
 *
 * The feed subscribes to `huddlePosts.byTeam`, so a post written by one team
 * member must appear in another member's open feed without a reload.
 *
 * Both sessions must be viewing the SAME team feed. Every user has a private
 * "Personal" team that only they see — the app defaults to Personal on first
 * login, so both sessions are switched to the shared seed team "Test Team
 * Alpha" (TEST01) before anything is asserted.
 *
 * Assertions are on the post's own unique text, not on a count: a count match
 * can be satisfied by the wrong post arriving, and the previous version of the
 * only real test here was wrapped in `if (count > 0)` guards that silently
 * skipped it whenever the composer failed to open.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { composerEditor, postContainer, switchToCardView } from '../huddle/helpers';

async function openSharedFeed(page: Page): Promise<void> {
  await page.goto('/app/huddle');
  await selectSharedTestTeam(page);
  await switchToCardView(page);
  await page.getByText('Share an update...').waitFor({ state: 'visible', timeout: 20000 });
}

async function post(page: Page, body: string): Promise<void> {
  await page.getByText('Share an update...').click();
  const editor = composerEditor(page);
  await editor.waitFor({ state: 'visible', timeout: 20000 });
  await editor.fill(body);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(postContainer(page, body)).toHaveCount(1, { timeout: 20000 });
}

test.describe('Real-time Huddle Posts', () => {
  let session1: Page;
  let session2: Page;

  test.beforeEach(async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    await loginAs(session1, TEST_USERS.admin1);
    await loginAs(session2, TEST_USERS.admin2);

    await openSharedFeed(session1);
    await openSharedFeed(session2);
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('a post reaches the other member’s open feed', async () => {
    const body = `Realtime post from admin1 ${Date.now()}`;

    await post(session1, body);

    await expect(postContainer(session2, body)).toHaveCount(1, { timeout: 20000 });
  });

  test('the sync runs both ways', async () => {
    // The publication is per-team, not per-author; a one-directional pass
    // would still be consistent with a stream that only echoes the writer.
    const body = `Realtime post from admin2 ${Date.now()}`;

    await post(session2, body);

    await expect(postContainer(session1, body)).toHaveCount(1, { timeout: 20000 });
  });

  test('an arriving post does not disturb the ones already shown', async () => {
    const first = `First realtime post ${Date.now()}`;
    await post(session1, first);
    await expect(postContainer(session2, first)).toHaveCount(1, { timeout: 20000 });

    const second = `Second realtime post ${Date.now()}`;
    await post(session1, second);

    await expect(postContainer(session2, second)).toHaveCount(1, { timeout: 20000 });
    await expect(postContainer(session2, first)).toHaveCount(1);
  });
});
