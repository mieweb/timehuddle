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

/** Create a channel through the Messages UI (mirrors channels.spec.ts's helper). */
async function createChannel(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create channel' }).click();
  await page.getByLabel('Channel name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByPlaceholder(`Message #${name}`)).toBeVisible({ timeout: 10000 });
}

async function getChannelIdByName(teamId: string, name: string): Promise<string> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const channel = await client.db().collection('channels').findOne({ teamId, name });
    if (!channel) throw new Error(`Channel "${name}" not found for team ${teamId}`);
    return String(channel._id);
  } finally {
    await client.close();
  }
}

/** e2e-* channels aren't cleaned by global-teardown (keyed on `userId`, channels use `createdBy`). */
async function deleteChannel(channelId: string): Promise<void> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    await client.db().collection('channelmessages').deleteMany({ channelId });
    await client
      .db()
      .collection('channels')
      .deleteOne({ _id: new ObjectId(channelId) });
  } finally {
    await client.close();
  }
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
    await expect(page.locator(`#huddle-post-${firstId}`)).not.toHaveClass(/huddle-post-highlight/);
  });

  test('re-tapping the same post link restarts its highlight', async ({ page }) => {
    test.setTimeout(90000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    await openHuddleFeed(page);

    const postId = await postViaComposer(page, `repeat-tap target ${Date.now()}`);
    const card = page.locator(`#huddle-post-${postId}`);

    await tapNotification(page, `/app/huddle?postId=${postId}&teamId=${teamId}`);
    await expect(card).toHaveClass(/huddle-post-highlight/, { timeout: 15000 });

    // The highlight lives 6s. Tapping the same post again part-way through
    // used to write the identical id back, which React treats as a no-op, so
    // neither the scroll nor the expiry timer restarted and the highlight
    // still died on the original schedule.
    await page.waitForTimeout(4000);
    await tapNotification(page, `/app/huddle?postId=${postId}&teamId=${teamId}`);

    // Comfortably past the first tap's 6s expiry, well short of the second's.
    await page.waitForTimeout(3500);
    await expect(card).toHaveClass(/huddle-post-highlight/);
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

  test('a dashboard timesheet link opens the linked member, and a different one on repeat tap', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    const member1Id = await getUserIdByEmail(TEST_USERS.member1.email);
    const member2Id = await getUserIdByEmail(TEST_USERS.member2.email);

    await page.goto('/app/dashboard');
    await page.getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible' });

    await tapNotification(
      page,
      `/app/dashboard?tab=timesheet&teamId=${teamId}&memberId=${member1Id}`,
    );
    const memberSelect = page.getByRole('combobox', { name: 'Member' });
    await expect(memberSelect).toHaveText(TEST_USERS.member1.name, { timeout: 15000 });

    // Only the query string changes here — the panel stays mounted, so a
    // second member's deep-link must override the first, not be ignored.
    await tapNotification(
      page,
      `/app/dashboard?tab=timesheet&teamId=${teamId}&memberId=${member2Id}`,
    );
    await expect(memberSelect).toHaveText(TEST_USERS.member2.name, { timeout: 15000 });

    // Picking a member by hand leaves the URL untouched, so tapping member2's
    // notification again pushes an unchanged `memberId`. Keyed on the id
    // alone, the panel considered it already applied and ignored the tap.
    await memberSelect.click();
    await page.getByRole('option', { name: TEST_USERS.member1.name }).click();
    await expect(memberSelect).toHaveText(TEST_USERS.member1.name);

    await tapNotification(
      page,
      `/app/dashboard?tab=timesheet&teamId=${teamId}&memberId=${member2Id}`,
    );
    await expect(memberSelect).toHaveText(TEST_USERS.member2.name, { timeout: 15000 });
  });

  test('a message channel link opens the linked channel, and a different one on repeat tap', async ({
    page,
  }) => {
    test.setTimeout(90000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);

    await page.goto('/app/messages');
    await page
      .getByRole('button', { name: 'Create channel' })
      .waitFor({ state: 'visible', timeout: 20000 });

    const stamp = Date.now();
    const channelA = `e2e-deep-link-a-${stamp}`;
    const channelB = `e2e-deep-link-b-${stamp}`;
    await createChannel(page, channelA);
    await createChannel(page, channelB);
    const channelAId = await getChannelIdByName(teamId, channelA);
    const channelBId = await getChannelIdByName(teamId, channelB);

    try {
      await tapNotification(page, `/app/messages?openTeam=${teamId}&openChannel=${channelAId}`);
      await expect(page.getByPlaceholder(`Message #${channelA}`)).toBeVisible({
        timeout: 15000,
      });

      // Only the query string changes here — Messages stays mounted, so a
      // second channel's deep-link must be resolved too, not swallowed as a
      // no-op because `routerSearch` looks like it hasn't changed enough.
      await tapNotification(page, `/app/messages?openTeam=${teamId}&openChannel=${channelBId}`);
      await expect(page.getByPlaceholder(`Message #${channelB}`)).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await deleteChannel(channelAId);
      await deleteChannel(channelBId);
    }
  });
});
