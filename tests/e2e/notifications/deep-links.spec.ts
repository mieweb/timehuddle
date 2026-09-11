/**
 * Notification deep links E2E.
 *
 * A notification URL is mostly query string — `?postId=`, `?teamId=`, `?tab=`
 * — and every regression in this area has been the query half getting lost:
 * stripped before navigation, read only at mount, or consumed against stale
 * state. These tests drive the same `pushState` + `popstate` pair the app's own
 * notification handlers use, because that is the path that breaks. A
 * `page.goto` rebuilds the whole app and would pass even with the bug present.
 */
import { expect, test, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { composerEditor, switchToCardView } from '../huddle/helpers';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

/** The seed user's `_id`, needed to build `/app/profile/:id` deep links. */
async function getUserIdByEmail(email: string): Promise<string> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const user = await client
      .db()
      .collection('users')
      .findOne({ 'emails.address': email }, { projection: { _id: 1 } });
    if (!user) throw new Error(`Seed user ${email} not found — did global-setup run?`);
    return String(user._id);
  } finally {
    await client.close();
  }
}

/** Any team the user belongs to other than `excludeTeamId` (their personal one). */
async function getOtherTeamId(email: string, excludeTeamId: string): Promise<string | null> {
  const userId = await getUserIdByEmail(email);
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const team = await client
      .db()
      .collection('teams')
      .findOne({ members: userId, _id: { $ne: new ObjectId(excludeTeamId) } });
    return team ? String(team._id) : null;
  } finally {
    await client.close();
  }
}

/**
 * Navigate the way a tapped notification does: rewrite the URL in place and
 * let the router pick it up. No remount, so a page that only reads its deep
 * link at mount will fail here — which is the point.
 */
async function tapNotification(page: Page, url: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

/** Publish a post and return its id, read back off the rendered card. */
async function postViaComposer(page: Page, text: string): Promise<string> {
  await page.getByText('Share an update...').click();
  const editor = composerEditor(page);
  await editor.waitFor({ state: 'visible', timeout: 20000 });
  await editor.click();
  await page.keyboard.type(text, { delay: 20 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();

  const card = page.locator('[data-testid="post-card"]').filter({ hasText: text }).first();
  await card.waitFor({ state: 'visible', timeout: 20000 });
  const domId = await card.getAttribute('id');
  if (!domId) throw new Error(`Post card for "${text}" has no id attribute`);
  return domId.replace('huddle-post-', '');
}

/** Force the app onto `teamId` the way the team fixture does, then reload. */
async function selectTeam(page: Page, teamId: string): Promise<void> {
  await page.evaluate((id) => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('app:selectedTeamId'))
      .forEach((k) => localStorage.setItem(k, id));
    localStorage.setItem('app:selectedTeamId', id);
  }, teamId);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function openHuddleFeed(page: Page): Promise<void> {
  await page.goto('/app/huddle');
  await switchToCardView(page);
}

test.describe('Notification deep links', () => {
  test('a post link highlights the target and clears the consumed query', async ({ page }) => {
    test.setTimeout(90000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    await openHuddleFeed(page);

    const text = `deep-link target ${Date.now()}`;
    const postId = await postViaComposer(page, text);

    await tapNotification(page, `/app/huddle?postId=${postId}&teamId=${teamId}`);

    await expect(page.locator(`#huddle-post-${postId}`)).toHaveClass(/huddle-post-highlight/, {
      timeout: 15000,
    });
    // Left in place, a stale ?postId= makes the next identical tap a no-op.
    await expect.poll(() => new URL(page.url()).search, { timeout: 10000 }).toBe('');
  });

  test('a second post link is honoured while already on the feed', async ({ page }) => {
    test.setTimeout(120000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    await openHuddleFeed(page);

    const stamp = Date.now();
    const firstId = await postViaComposer(page, `first deep-link post ${stamp}`);
    const secondId = await postViaComposer(page, `second deep-link post ${stamp}`);

    await tapNotification(page, `/app/huddle?postId=${firstId}&teamId=${teamId}`);
    await expect(page.locator(`#huddle-post-${firstId}`)).toHaveClass(/huddle-post-highlight/, {
      timeout: 15000,
    });

    // Only the query string changes here. Nothing remounts, so this is the tap
    // that used to be swallowed.
    await tapNotification(page, `/app/huddle?postId=${secondId}&teamId=${teamId}`);
    await expect(page.locator(`#huddle-post-${secondId}`)).toHaveClass(/huddle-post-highlight/, {
      timeout: 15000,
    });
    await expect(page.locator(`#huddle-post-${firstId}`)).not.toHaveClass(
      /huddle-post-highlight/,
    );
  });

  test('a post link switches to the post team when another team is selected', async ({ page }) => {
    test.setTimeout(120000);
    await loginAs(page, TEST_USERS.owner1);
    const sharedTeamId = await selectSharedTestTeam(page);
    await openHuddleFeed(page);

    const text = `cross-team target ${Date.now()}`;
    const postId = await postViaComposer(page, text);

    const otherTeamId = await getOtherTeamId(TEST_USERS.owner1.email, sharedTeamId);
    test.skip(!otherTeamId, 'owner1 belongs to only one team — nothing to switch away from');

    await selectTeam(page, otherTeamId!);
    await openHuddleFeed(page);
    // The feed only ever holds the selected team's posts.
    await expect(page.locator(`#huddle-post-${postId}`)).toHaveCount(0);

    await tapNotification(page, `/app/huddle?postId=${postId}&teamId=${sharedTeamId}`);

    await expect(page.locator(`#huddle-post-${postId}`)).toHaveClass(/huddle-post-highlight/, {
      timeout: 20000,
    });
  });

  test('a profile link opens the Work tab, and does so again after switching back', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await loginAs(page, TEST_USERS.owner1);
    const userId = await getUserIdByEmail(TEST_USERS.owner1.email);
    const profileUrl = `/app/profile/${userId}?tab=work`;

    await page.goto(`/app/profile/${userId}`);
    const workTab = page.getByRole('tab', { name: 'Work' });
    const feedTab = page.getByRole('tab', { name: 'Feed' });
    await workTab.waitFor({ state: 'visible', timeout: 20000 });

    await tapNotification(page, profileUrl);
    await expect(workTab).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    await expect.poll(() => new URL(page.url()).search, { timeout: 10000 }).toBe('');

    // Switching by hand leaves the URL untouched, so a repeat tap pushes the
    // same query string again — it must still be acted on.
    await feedTab.click();
    await expect(feedTab).toHaveAttribute('aria-selected', 'true');

    await tapNotification(page, profileUrl);
    await expect(workTab).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
  });
});
