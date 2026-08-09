/**
 * Huddle — Edit Composer Remount Regression Test
 *
 * Covers the fix in commit "fix(ios): resolve App Review rejections and
 * Capacitor editor bugs": HuddleComposer's RichEditor (Kerebron) is
 * uncontrolled and only reads `initialText`/`collab` at mount. Before the
 * fix, the composer had no `key` prop, so React reused the same editor
 * instance when switching between "Edit post" targets — the second post's
 * edit composer kept showing the first post's stale text instead of its own.
 *
 * The fix keys the composer on `editing ? `edit-${collabRoom ?? 'new'}` :
 * 'compose'`, forcing a remount (and fresh seed) whenever the edit target
 * changes.
 *
 * This test is browser-only (no Capacitor runtime needed) because neither
 * the `key` prop nor the seeding logic is gated behind a native-platform
 * check — the bug and its fix apply identically on web and in the iOS app.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';

const BASE_URL = 'http://localhost:3002';

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/app`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

async function goToHuddle(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/app/huddle`);
  await page.waitForLoadState('networkidle');
}

/** PostCard (`data-testid="post-card"`) only exists in Cards view. */
async function switchToCardView(page: Page): Promise<void> {
  const switchBtn = page.getByRole('button', { name: 'Switch to card view' });
  if (await switchBtn.isVisible({ timeout: 3000 })) {
    await switchBtn.click();
    await page.getByRole('button', { name: 'Switch to chat view' }).waitFor({ timeout: 5000 });
  }
  // DDP delivers the feed over WebSockets, so `networkidle` won't cover it.
  await page.waitForTimeout(2000);
}

async function postViaComposer(page: Page, text: string): Promise<void> {
  await page.getByText('Share an update...').click();
  const composerEditor = page.locator('.ProseMirror').first();
  await composerEditor.waitFor({ state: 'visible', timeout: 10000 });
  await composerEditor.click();
  await page.keyboard.type(text, { delay: 30 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 10000 });
}

/** Opens the "Edit post" composer for the card containing `seedText`. */
async function openEditComposer(page: Page, seedText: string): Promise<void> {
  const postCard = page.locator('[data-testid="post-card"]').filter({ hasText: seedText }).first();
  await postCard.waitFor({ state: 'visible', timeout: 15000 });

  const menuButton = postCard
    .locator('button')
    .filter({ has: page.locator('circle') })
    .last();
  await menuButton.click();
  await page.getByRole('button', { name: 'Edit post' }).click();
  await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 10000 });
}

async function editorText(page: Page): Promise<string> {
  return page.locator('.ProseMirror').first().innerText();
}

async function deletePostByText(page: Page, seedText: string): Promise<void> {
  await switchToCardView(page);
  const postCard = page.locator('[data-testid="post-card"]').filter({ hasText: seedText }).first();
  if (!(await postCard.isVisible({ timeout: 2000 }).catch(() => false))) return;
  const menuButton = postCard
    .locator('button')
    .filter({ has: page.locator('circle') })
    .last();
  const deleteBtn = page.getByRole('button', { name: 'Delete post' });
  await expect(async () => {
    await menuButton.click();
    await expect(deleteBtn).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000, intervals: [500] });
  await deleteBtn.click();
  const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i }).first();
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click();
  }
}

test.describe('Huddle — edit composer remounts per post (Capacitor editor fix)', () => {
  test.slow();

  let page: Page;
  const postAText = `edit-remount-a-${Date.now()}`;
  const postBText = `edit-remount-b-${Date.now()}`;

  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await loginAs(page, TEST_USERS.member1.email, TEST_USERS.member1.password);
    await goToHuddle(page);
    await selectSharedTestTeam(page);
    await switchToCardView(page);
  });

  test.afterEach(async () => {
    await deletePostByText(page, postAText);
    await deletePostByText(page, postBText);
    await page.context().close();
  });

  test('switching the edit target between two posts seeds the correct text each time', async () => {
    // Seed two distinct posts.
    await postViaComposer(page, postAText);
    await postViaComposer(page, postBText);
    await switchToCardView(page);

    // Open edit on post A — editor must seed with A's text, not blank/stale.
    await openEditComposer(page, postAText);
    await expect(async () => {
      expect(await editorText(page)).toContain(postAText);
    }).toPass({ timeout: 5000, intervals: [250] });

    // Cancel without saving, then immediately edit post B. Pre-fix, the
    // composer instance (and its uncontrolled RichEditor) was reused across
    // edit targets, so this second open could still show post A's text.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await openEditComposer(page, postBText);
    await expect(async () => {
      const text = await editorText(page);
      expect(text).toContain(postBText);
      expect(text).not.toContain(postAText);
    }).toPass({ timeout: 5000, intervals: [250] });

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
});
