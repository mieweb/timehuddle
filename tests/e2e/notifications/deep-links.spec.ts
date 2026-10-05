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
import { selectSharedTestTeam, selectTeamById } from '../fixtures/team';
import { getUserIdByEmail, inboxMessage, seedPost } from '../huddle/helpers';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

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

/** "YYYY-MM-DD" for `daysAgo` days before today, on the local calendar. */
function localDate(daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function openHuddleFeed(page: Page): Promise<void> {
  await page.goto('/app/huddle');
  await page.getByRole('button', { name: /^Team:/ }).waitFor({ state: 'visible', timeout: 20000 });
}

/** A post opened by a deep link: its conversation is the one on screen. */
const openedPost = (page: Page, text: string) => inboxMessage(page, text).first();

test.describe('Notification deep links', () => {
  test('a post link opens its conversation and becomes a conversation link', async ({ page }) => {
    test.setTimeout(90000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);

    // Yesterday's post is its own conversation, and not the newest one the
    // inbox opens by default — so seeing it proves the link opened it.
    const text = `deep-link target ${Date.now()}`;
    const postId = await seedPost(page, { teamId, text, postDate: localDate(1) });
    await seedPost(page, { teamId, text: `deep-link newer ${Date.now()}` });
    await openHuddleFeed(page);

    await tapNotification(page, `/app/huddle?postId=${postId}&teamId=${teamId}`);

    await expect(openedPost(page, text)).toBeVisible({ timeout: 15000 });
    // The post resolves to the conversation holding it: that's the durable
    // link. Left in place, a stale ?postId= would make the next identical tap
    // a no-op.
    const params = () => new URL(page.url()).searchParams;
    await expect.poll(() => params().get('conversation'), { timeout: 10000 }).toMatch(/^session:/);
    expect(params().get('team')).toBe(teamId);
    expect(params().has('postId')).toBe(false);
    expect(params().has('teamId')).toBe(false);

    // …and survives a reload.
    await page.reload();
    await expect(openedPost(page, text)).toBeVisible({ timeout: 20000 });
  });

  test('a second post link is honoured while already on the feed', async ({ page }) => {
    test.setTimeout(120000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);

    // Different days, so different conversations.
    const stamp = Date.now();
    const firstText = `first deep-link post ${stamp}`;
    const secondText = `second deep-link post ${stamp}`;
    const firstId = await seedPost(page, { teamId, text: firstText, postDate: localDate(2) });
    const secondId = await seedPost(page, { teamId, text: secondText, postDate: localDate(1) });
    await openHuddleFeed(page);

    await tapNotification(page, `/app/huddle?postId=${firstId}&teamId=${teamId}`);
    await expect(openedPost(page, firstText)).toBeVisible({ timeout: 15000 });

    // Only the query string changes here. Nothing remounts, so this is the tap
    // that used to be swallowed.
    await tapNotification(page, `/app/huddle?postId=${secondId}&teamId=${teamId}`);
    await expect(openedPost(page, secondText)).toBeVisible({ timeout: 15000 });
    await expect(openedPost(page, firstText)).toBeHidden();
  });

  test('re-tapping the same post link reopens it after moving away', async ({ page }) => {
    test.setTimeout(90000);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);

    const text = `repeat-tap target ${Date.now()}`;
    const postId = await seedPost(page, { teamId, text, postDate: localDate(1) });
    await seedPost(page, { teamId, text: `repeat-tap other ${Date.now()}` });
    await openHuddleFeed(page);
    const link = `/app/huddle?postId=${postId}&teamId=${teamId}`;

    await tapNotification(page, link);
    await expect(openedPost(page, text)).toBeVisible({ timeout: 15000 });

    // Move to another conversation by hand, then tap the same link again. It
    // must still be acted on, not treated as already handled.
    await page
      .locator(
        '[data-slot="superchat-conversation-list"] [role="listitem"] button:not([aria-current])',
      )
      .first()
      .click();
    await expect(openedPost(page, text)).toBeHidden();

    await tapNotification(page, link);
    await expect(openedPost(page, text)).toBeVisible({ timeout: 15000 });
  });

  test('a post link switches to the post team when another team is selected', async ({ page }) => {
    test.setTimeout(120000);
    await loginAs(page, TEST_USERS.owner1);
    const sharedTeamId = await selectSharedTestTeam(page);

    const text = `cross-team target ${Date.now()}`;
    const postId = await seedPost(page, { teamId: sharedTeamId, text });

    const otherTeamId = await getOtherTeamId(TEST_USERS.owner1.email, sharedTeamId);
    test.skip(!otherTeamId, 'owner1 belongs to only one team — nothing to switch away from');

    await selectTeamById(page, otherTeamId!);
    await openHuddleFeed(page);
    const sharedTeamPicker = page.getByRole('button', { name: 'Team: Test Team Alpha' });
    await expect(sharedTeamPicker).toBeHidden();

    await tapNotification(page, `/app/huddle?postId=${postId}&teamId=${sharedTeamId}`);

    await expect(sharedTeamPicker).toBeVisible({ timeout: 20000 });
    await expect(openedPost(page, text)).toBeVisible({ timeout: 20000 });
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
    // The tab is part of the link now, so a reload keeps it.
    expect(new URL(page.url()).searchParams.get('tab')).toBe('work');

    // Switching by hand writes the URL too, so a repeat tap is a real change
    // and is acted on.
    await feedTab.click();
    await expect(feedTab).toHaveAttribute('aria-selected', 'true');
    expect(new URL(page.url()).searchParams.has('tab')).toBe(false);

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
});
