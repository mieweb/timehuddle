/**
 * Profile Feed tab — a person's Huddle posts (#576).
 *
 * Clicking a post author on the Huddle page opens their profile, whose Feed tab
 * renders that person's posts in the selected team through the same
 * `HuddleFeed` as the Huddle page — read-only (no composer), with the same
 * edit/delete permissions, comments and likes.
 *
 * Two posts are written through the real composer up front — one by owner1,
 * one by member1 — so each test can check that the feed holds one author's
 * posts and not the other's. admin3 is used by no other spec and never posts,
 * so their profile is the empty state.
 */
import { expect, test, type Browser } from '@playwright/test';
import { TEST_USERS, getUserIdByEmail, loginAs, type TestUser } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { ProfilePage } from '../pages/ProfilePage';
import {
  composerEditor,
  openComposer,
  postContainer,
  submitPost,
  switchToCardView,
} from './helpers';

const stamp = Date.now();
const OWNER_POST = `profile-feed-owner-${stamp}`;
const MEMBER_POST = `profile-feed-member-${stamp}`;

async function postAs(browser: Browser, baseURL: string, user: TestUser, text: string) {
  const page = await browser.newPage({ baseURL });
  try {
    await loginAs(page, user);
    await selectSharedTestTeam(page);
    await openComposer(page);
    await composerEditor(page).fill(text);
    await submitPost(page);
  } finally {
    await page.close();
  }
}

test.describe('Profile Feed tab — a person’s Huddle posts', () => {
  test.slow();

  let ownerId: string;
  let memberId: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL as string;
    ownerId = await getUserIdByEmail(TEST_USERS.owner1.email);
    memberId = await getUserIdByEmail(TEST_USERS.member1.email);
    await postAs(browser, baseURL, TEST_USERS.owner1, OWNER_POST);
    await postAs(browser, baseURL, TEST_USERS.member1, MEMBER_POST);
  });

  test('clicking a post author opens their profile Feed with only their posts', async ({
    page,
  }) => {
    await loginAs(page, TEST_USERS.member1);
    await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
    await switchToCardView(page);

    await postContainer(page, OWNER_POST)
      .getByRole('button', { name: "View Test Owner One's profile" })
      .first()
      .click();
    await page.waitForURL(`**/app/profile/${ownerId}`);

    const profile = new ProfilePage(page);
    await expect(profile.tab('Feed')).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('tablist', { name: 'Profile sections' }).getByRole('tab'),
    ).toHaveText(['Feed', 'Work', 'Activity']);
    await expect(profile.feedPost(OWNER_POST)).toBeVisible({ timeout: 15000 });
    await expect(profile.feedPost(MEMBER_POST)).toHaveCount(0);
    for (const card of await profile.feedPosts().all()) {
      await expect(card).toContainText('Test Owner One');
    }

    // Read-only feed, and a plain teammate can't edit or delete someone else's post.
    await expect(page.getByText('Share an update...')).toHaveCount(0);
    await expect(
      profile.feedPost(OWNER_POST).getByRole('button', { name: 'Post actions' }),
    ).toHaveCount(0);
  });

  test('your own profile has no composer, but you can edit your posts', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);

    const profile = new ProfilePage(page);
    await profile.gotoUser(ownerId);
    const card = profile.feedPost(OWNER_POST);
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Share an update...')).toHaveCount(0);

    await card.getByRole('button', { name: 'Post actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit post' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Delete/ })).toBeVisible();
  });

  test('a team admin can edit and delete a teammate’s posts', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin1);
    await selectSharedTestTeam(page);

    const profile = new ProfilePage(page);
    await profile.gotoUser(memberId);
    const card = profile.feedPost(MEMBER_POST);
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card.getByRole('button', { name: 'Post actions' })).toBeVisible();
  });

  test('a comment added on the profile feed shows up', async ({ page }) => {
    const comment = `profile-feed-comment-${Date.now()}`;
    await loginAs(page, TEST_USERS.member1);
    await selectSharedTestTeam(page);

    const profile = new ProfilePage(page);
    await profile.gotoUser(ownerId);
    const card = profile.feedPost(OWNER_POST);
    await expect(card).toBeVisible({ timeout: 15000 });

    // The like and comment toggles are the two buttons labelled only by a count.
    await card.getByRole('button', { name: /^\d+$/ }).nth(1).click();
    await card.getByRole('textbox', { name: 'Comment' }).fill(comment);
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card.getByText(comment)).toBeVisible({ timeout: 10000 });
  });

  test('someone with no posts in the team gets an empty state', async ({ page }) => {
    await loginAs(page, TEST_USERS.member1);
    await selectSharedTestTeam(page);

    const profile = new ProfilePage(page);
    await profile.gotoUser(await getUserIdByEmail(TEST_USERS.admin3.email));
    await expect(page.getByText('No posts in this team yet.')).toBeVisible({ timeout: 15000 });
    await expect(profile.feedPosts()).toHaveCount(0);
  });

  test('on a phone the tab rail stays pinned and compact while you scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, TEST_USERS.member1);
    await selectSharedTestTeam(page);

    const profile = new ProfilePage(page);
    await profile.gotoUser(ownerId);
    await expect(profile.feedPost(OWNER_POST)).toBeVisible({ timeout: 15000 });

    // Seeded feeds are short, so stand in for a long one by making the tab
    // container tall. A sticky element only pins within its parent's content
    // box, and min-height grows that box without adding anything between the
    // rail and the tab panels.
    const rail = page.locator('.profile-tab-rail');
    await rail.evaluate((el) => (el.parentElement!.style.minHeight = '4000px'));
    const railOffset = () =>
      rail.evaluate(
        (el) => el.getBoundingClientRect().top - el.closest('main')!.getBoundingClientRect().top,
      );
    await page.locator('main').evaluate((el) => (el.scrollTop = 1500));
    await expect.poll(railOffset).toBe(0);
    expect((await rail.boundingBox())!.height).toBeLessThanOrEqual(36);

    // Switching while pinned opens the new tab at its top, not mid-scroll: its
    // panel starts just under the rail (the rail's 16px bottom margin). Without
    // the jump it would begin far above the screen.
    await profile.tab('Work').click();
    await expect(profile.tab('Work')).toHaveAttribute('aria-selected', 'true');
    const gapUnderRail = () =>
      page.getByRole('tabpanel', { name: 'Work' }).evaluate((panel) => {
        const railBottom = document.querySelector('.profile-tab-rail')!.getBoundingClientRect();
        return Math.round(panel.getBoundingClientRect().top - railBottom.bottom);
      });
    await expect.poll(gapUnderRail).toBe(16);
  });
});
