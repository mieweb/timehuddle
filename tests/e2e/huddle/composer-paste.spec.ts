/**
 * Huddle Composer — pasting a screenshot.
 *
 * Kerebron's own paste handler embeds a pasted image inline as a base64 `data:`
 * URL, which bloats the post document by hundreds of KB and never puts the file
 * in the media store. The composer intercepts the paste first and uploads it
 * like any other attachment (MarkdownEditor's capture-phase listener ->
 * useAttachmentUpload).
 *
 * The load-bearing assertion in every test here is the *negative* one: no
 * `data:` URL survives anywhere. A paste that silently fell back to Kerebron's
 * handler would still produce a visible image in the feed, so asserting only
 * "an image is shown" would pass against the exact bug this replaced.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  FIXTURE,
  attachmentChipCount,
  composerEditor,
  openComposer,
  pasteFiles,
  pasteText,
  postContainer,
  submitPost,
  switchToCardView,
} from './helpers';

const SCREENSHOT = { fixture: FIXTURE.image, name: 'screenshot.png', type: 'image/png' };

test.describe('Huddle composer — screenshot paste', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
  });

  test('pasting a screenshot uploads it as an attachment instead of inlining base64', async ({
    page,
  }) => {
    const postText = `Pasted screenshot ${Date.now()}`;
    await composerEditor(page).fill(postText);

    await pasteFiles(page, [SCREENSHOT]);

    // It became a real attachment chip…
    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);
    // …and no image node was inserted into the document. Checking for an <img>
    // rather than for "data:" in the text: an embedded image is a ProseMirror
    // node, so its base64 src lives in an attribute that textContent never
    // exposes — a text assertion would pass even when the paste was inlined.
    await expect(composerEditor(page).locator('img')).toHaveCount(0);
    await expect(composerEditor(page)).toContainText(postText);

    await submitPost(page);
    await switchToCardView(page);

    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 20000 });

    // Served from the media store, not embedded in the document.
    const img = post.locator('img[src*="/uploads/media/"]');
    await expect(img).toBeVisible({ timeout: 15000 });
    await expect(post.locator('img[src^="data:"]')).toHaveCount(0);

    // naturalWidth is the real proof the src resolves: a broken src still
    // renders an <img>, but only a decoded image has intrinsic dimensions.
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15000 })
      .toBeGreaterThan(0);
  });

  test('pasting a screenshot into an empty composer posts image-only', async ({ page }) => {
    await pasteFiles(page, [SCREENSHOT]);
    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);

    // An attachment alone is enough content to post — the button must enable
    // without any text, and only once the upload has actually landed.
    const postButton = page.getByRole('button', { name: 'Post', exact: true });
    await expect(postButton).toBeEnabled();
    await submitPost(page);

    await switchToCardView(page);
    // Scoped to the newest card, not "any card in the feed": the suite is
    // serial against a shared team, so earlier tests have already left images
    // in this feed and an unscoped match would pass without posting anything.
    // The feed sorts createdAt descending, so the first card is this post.
    const newest = page.locator('[data-testid="post-card"]').first();
    await expect(newest.locator('img[src*="/uploads/media/"]')).toBeVisible({ timeout: 20000 });
  });

  test('pasting several images at once uploads every one', async ({ page }) => {
    const postText = `Multi paste ${Date.now()}`;
    await composerEditor(page).fill(postText);

    await pasteFiles(page, [
      { ...SCREENSHOT, name: 'shot-one.png' },
      { ...SCREENSHOT, name: 'shot-two.png' },
    ]);

    // Uploads run sequentially through one shared hook — the second must not
    // clobber the first's chip.
    await expect.poll(() => attachmentChipCount(page), { timeout: 45000 }).toBe(2);
    await expect(composerEditor(page).locator('img')).toHaveCount(0);
  });

  test('shows upload progress and blocks posting while a pasted image is in flight', async ({
    page,
  }) => {
    await composerEditor(page).fill(`Paste progress ${Date.now()}`);

    const progressBar = page.locator('[data-testid="post-progress-bar"]');
    const progressVisible = progressBar.waitFor({ state: 'visible', timeout: 15000 });

    await pasteFiles(page, [SCREENSHOT]);
    await progressVisible;

    // Same bar and labelling as a picker-driven upload — a paste is not a
    // second, quieter upload path.
    await expect(progressBar).toHaveAttribute('aria-label', 'Uploading attachment');
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled();

    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled();
  });

  test('pasting plain text still goes into the editor', async ({ page }) => {
    // Regression guard on the interception: it must return early for anything
    // that carries no image files, or ordinary copy-paste breaks entirely.
    const pasted = `Pasted plain text ${Date.now()}`;
    await composerEditor(page).click();
    await pasteText(page, pasted);

    await expect(composerEditor(page)).toContainText(pasted, { timeout: 10000 });
    expect(await attachmentChipCount(page)).toBe(0);
  });
});
