/**
 * Huddle — Yjs Real-Time Collaborative Editing Tests
 *
 * Verifies that two users editing the same huddle post simultaneously see each
 * other's keystrokes in real-time via the Yjs WebSocket relay (/yjs/<postId>).
 *
 * Scenario:
 *   1. member1 creates a post in the Huddle feed.
 *   2. Both member1 and admin1 open that post's edit composer.
 *   3. admin1 types additional text — it must appear live in member1's editor
 *      (and vice-versa) without either user saving.
 *
 * The test uses two isolated browser contexts (separate sessions / cookies) to
 * simulate two real users, matching the screenshot scenario.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { TEST_USERS } from '../fixtures/users';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3002';
/** Unique suffix keeps the post identifiable even if other tests leave stale posts. */
const POST_SEED_TEXT = `collab-seed-${Date.now()}`;
/** Text typed by admin1 into the shared editor. */
const ADMIN_TYPED_TEXT = 'admin-collab-edit';
/** Text typed back by member1. */
const MEMBER_TYPED_TEXT = 'member-collab-reply';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Log in to the app and wait for the dashboard redirect. */
async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/app`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/** Navigate to the Huddle feed and wait until it finishes loading. */
async function goToHuddle(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/app/huddle`);
  await page.waitForLoadState('networkidle');
}

/**
 * Switch the Huddle feed to Cards view (if it's in Chat/SuperChat view).
 * The PostCard components with `data-testid="post-card"` only exist in Cards view.
 */
async function switchToCardView(page: Page): Promise<void> {
  const switchBtn = page.getByRole('button', { name: 'Switch to card view' });
  if (await switchBtn.isVisible({ timeout: 3000 })) {
    await switchBtn.click();
    // Wait for at least one post-card to appear, or for the button label to flip
    await page.getByRole('button', { name: 'Switch to chat view' }).waitFor({ timeout: 5000 });
  }
  // Give DDP subscription a moment to fully deliver the feed content after the
  // view switch — DDP uses WebSockets so `networkidle` won't capture it.
  await page.waitForTimeout(2000);
}

/**
 * Type in the ProseMirror (Kerebron) editor that is inside an element
 * matching `containerLocator`. We click the `.ProseMirror` node directly to
 * place the caret, then use `keyboard.type` to simulate real keystrokes so the
 * ProseMirror transaction pipeline fires normally.
 */
async function typeInEditor(page: Page, containerSelector: string, text: string): Promise<void> {
  const editor = page.locator(`${containerSelector} .ProseMirror`).first();
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  await editor.click({ position: { x: 10, y: 10 } });
  // Move to end of existing content before appending
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: 50 });
}

/**
 * Open the three-dot menu on a post containing `seedText` and click "Edit post".
 * Waits until the HuddleComposer's ProseMirror editor appears.
 *
 * Targets `[data-testid="post-card"]` which is placed on the PostCard root div —
 * this avoids accidentally matching the collapsed new-post composer, which is
 * an uncontrolled ProseMirror editor that retains its last text content in the
 * DOM even after the post has been submitted.
 */
async function openEditComposer(page: Page, seedText: string): Promise<void> {
  const postCard = page.locator('[data-testid="post-card"]').filter({ hasText: seedText }).first();
  await postCard.waitFor({ state: 'visible', timeout: 15000 });

  // Open the three-dot menu (⋮ button inside the card)
  const menuButton = postCard
    .locator('button')
    .filter({ has: page.locator('circle') })
    .last();
  await menuButton.click();

  // Click "Edit post" in the dropdown
  await page.getByRole('button', { name: 'Edit post' }).click();

  // Wait for the ProseMirror editor to appear inside the edit composer
  await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Read the text content of the ProseMirror editor in a post card's edit
 * composer. Returns the raw innerText of the `.ProseMirror` node.
 */
async function editorText(page: Page): Promise<string> {
  return page.locator('.ProseMirror').first().innerText();
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

test.describe('Huddle — Yjs real-time collaborative editing', () => {
  test.setTimeout(90000);

  let memberCtx: BrowserContext;
  let adminCtx: BrowserContext;
  let memberPage: Page;
  let adminPage: Page;

  test.beforeEach(async ({ browser }) => {
    // Two isolated contexts = two independent cookie jars / Meteor sessions
    memberCtx = await browser.newContext();
    adminCtx = await browser.newContext();
    memberPage = await memberCtx.newPage();
    adminPage = await adminCtx.newPage();

    // Log in both users in parallel
    await Promise.all([
      loginAs(memberPage, TEST_USERS.member1.email, TEST_USERS.member1.password),
      loginAs(adminPage, TEST_USERS.admin1.email, TEST_USERS.admin1.password),
    ]);

    // Navigate both to the Huddle feed
    await Promise.all([goToHuddle(memberPage), goToHuddle(adminPage)]);

    // Both users must be in Cards view so PostCard elements are in the DOM
    await Promise.all([switchToCardView(memberPage), switchToCardView(adminPage)]);
  });

  test.afterEach(async () => {
    // Best-effort: delete any `collab-seed-` posts left by this run to keep
    // the feed clean for the next run.  Errors here are swallowed so a
    // cleanup failure never masks a real test failure.
    for (const page of [memberPage, adminPage]) {
      try {
        await switchToCardView(page);
        const staleCards = page.locator('[data-testid="post-card"]').filter({
          hasText: /^collab-seed-/,
        });
        const count = await staleCards.count();
        for (let i = 0; i < count; i++) {
          const card = staleCards.nth(i);
          const menuBtn = card
            .locator('button')
            .filter({ has: page.locator('circle') })
            .last();
          if (await menuBtn.isVisible({ timeout: 1000 })) {
            await menuBtn.click();
            const deleteBtn = page.getByRole('button', { name: 'Delete post' });
            if (await deleteBtn.isVisible({ timeout: 1000 })) await deleteBtn.click();
          }
        }
      } catch {
        /* swallow — cleanup is best-effort */
      }
    }
    await memberCtx.close();
    await adminCtx.close();
  });

  // ─── Test 1: member posts, admin edits, member sees it live ────────────────

  test('member posts, both open edit, admin types and member sees it in real-time', async () => {
    // ── Step 1: member1 creates the seed post ────────────────────────────────
    await memberPage.getByText('Share an update...').click();

    // The new-post composer uses a ProseMirror editor
    const composerEditor = memberPage.locator('.ProseMirror').first();
    await composerEditor.waitFor({ state: 'visible', timeout: 10000 });
    await composerEditor.click();
    await memberPage.keyboard.type(POST_SEED_TEXT, { delay: 30 });

    await memberPage.getByRole('button', { name: 'Post', exact: true }).click();

    // Confirm the post appears in the feed for member1
    await expect(memberPage.getByText(POST_SEED_TEXT).first()).toBeVisible({ timeout: 10000 });

    // Wait for DDP to replicate the post to admin1's session (allow up to 30s for DDP sync)
    await expect(adminPage.getByText(POST_SEED_TEXT).first()).toBeVisible({ timeout: 30000 });

    // ── Step 2: both users open the edit composer for that post ──────────────
    // member1 opens edit first
    await openEditComposer(memberPage, POST_SEED_TEXT);

    // admin1 opens edit on the same post
    await openEditComposer(adminPage, POST_SEED_TEXT);

    // Let the Yjs WebSocket handshake complete before typing
    await memberPage.waitForTimeout(1500);
    await adminPage.waitForTimeout(1500);

    // ── Step 3: admin1 types new text ─────────────────────────────────────────
    // Use body-level selector — there is only one edit composer open per page
    await typeInEditor(adminPage, 'body', ` ${ADMIN_TYPED_TEXT}`);

    // ── Step 4: member1 sees admin1's text without saving ─────────────────────
    await expect(async () => {
      const text = await editorText(memberPage);
      expect(text).toContain(ADMIN_TYPED_TEXT);
    }).toPass({ timeout: 8000, intervals: [500] });

    // ── Step 5: member1 types a reply back ───────────────────────────────────
    await typeInEditor(memberPage, 'body', ` ${MEMBER_TYPED_TEXT}`);

    // ── Step 6: admin1 sees member1's text ────────────────────────────────────
    await expect(async () => {
      const text = await editorText(adminPage);
      expect(text).toContain(MEMBER_TYPED_TEXT);
    }).toPass({ timeout: 8000, intervals: [500] });

    // ── Step 7: clean up — admin saves and then deletes the post ─────────────
    await adminPage.getByRole('button', { name: 'Update post', exact: true }).click();
    // Allow DDP to propagate the save
    await adminPage.waitForTimeout(1000);

    // Delete the post so subsequent runs don't accumulate stale posts
    const postCard = adminPage
      .locator('[data-testid="post-card"]')
      .filter({ hasText: POST_SEED_TEXT })
      .first();
    const menuButton = postCard
      .locator('button')
      .filter({ has: adminPage.locator('circle') })
      .last();
    await menuButton.click();
    await adminPage.getByRole('button', { name: 'Delete post' }).click();
    // Confirm deletion dialog if present
    const confirmBtn = adminPage.getByRole('button', { name: /confirm|yes|delete/i }).first();
    if (await confirmBtn.isVisible({ timeout: 2000 })) {
      await confirmBtn.click();
    }
  });

  // ─── Test 2: Yjs WebSocket connects when edit composer opens ───────────────

  test('edit composer establishes a Yjs WebSocket connection to /yjs/<postId>', async () => {
    // member1 creates a seed post
    await memberPage.getByText('Share an update...').click();
    const composerEditor = memberPage.locator('.ProseMirror').first();
    await composerEditor.waitFor({ state: 'visible', timeout: 10000 });
    await composerEditor.click();
    await memberPage.keyboard.type(POST_SEED_TEXT, { delay: 30 });
    await memberPage.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(memberPage.getByText(POST_SEED_TEXT).first()).toBeVisible({ timeout: 10000 });

    // Capture WebSocket traffic on admin's page
    const wsUrls: string[] = [];
    adminPage.on('websocket', (ws) => wsUrls.push(ws.url()));

    // admin opens edit — this should trigger the Yjs WebSocket upgrade
    await expect(adminPage.getByText(POST_SEED_TEXT).first()).toBeVisible({ timeout: 20000 });
    await openEditComposer(adminPage, POST_SEED_TEXT);

    // Give the WebSocket time to connect
    await adminPage.waitForTimeout(3000);

    // Verify at least one /yjs/<id> WebSocket was opened
    const yjsSocket = wsUrls.find((u) => u.includes('/yjs/'));
    expect(
      yjsSocket,
      `Expected a /yjs/<postId> WebSocket; got: ${JSON.stringify(wsUrls)}`,
    ).toBeTruthy();

    // Clean up
    await adminPage.getByRole('button', { name: 'Cancel' }).click();
    const postCard = memberPage
      .locator('[data-testid="post-card"]')
      .filter({ hasText: POST_SEED_TEXT })
      .first();
    const menuButton = postCard
      .locator('button')
      .filter({ has: memberPage.locator('circle') })
      .last();
    await menuButton.click();
    await memberPage.getByRole('button', { name: 'Delete post' }).click();
    const confirmBtn = memberPage.getByRole('button', { name: /confirm|yes|delete/i }).first();
    if (await confirmBtn.isVisible({ timeout: 2000 })) {
      await confirmBtn.click();
    }
  });
});
