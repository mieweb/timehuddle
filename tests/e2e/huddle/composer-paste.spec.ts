/**
 * Huddle Composer — pasting or dropping a screenshot.
 *
 * Kerebron's own media handlers embed an image inline as a base64 `data:` URL,
 * which bloats the post document by hundreds of KB (a 4 MB screenshot becomes
 * ~5.8 MB of markdown, past the API's 1 MB body limit) and never puts the file
 * in the media store. The composer intercepts both paste and drop first, uploads
 * the file like any other attachment, and writes the *uploaded* image back into
 * the document so the writer still sees it inline.
 *
 * So "an image appears in the editor" is not the assertion — that was true of
 * the bug too. The load-bearing pair is that the image is there **and** its src
 * is a `/uploads/media/` path rather than a `data:` URL, in the editor and in
 * the feed alike.
 *
 * `img[src]` throughout, never a bare `img`: ProseMirror keeps a src-less
 * `<img class="ProseMirror-separator">` in the document at all times, so an
 * unqualified count is always one higher than the number of real images.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  FIXTURE,
  attachmentChipCount,
  composerEditor,
  dropFiles,
  openComposer,
  pasteFiles,
  pasteText,
  postContainer,
  submitPost,
  switchToCardView,
} from './helpers';

const SCREENSHOT = { fixture: FIXTURE.image, name: 'screenshot.png', type: 'image/png' };

test.describe('Huddle composer — screenshot paste and drop', () => {
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
    // …and it previews inline, from the media store rather than from base64.
    const preview = composerEditor(page).locator('img[src]');
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('src', /^\/uploads\/media\//);
    await expect(composerEditor(page).locator('img[src^="data:"]')).toHaveCount(0);
    await expect(composerEditor(page)).toContainText(postText);

    await submitPost(page);
    await switchToCardView(page);

    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 20000 });

    // Served from the media store, not embedded in the document — and shown
    // once, though the post carries it both inline and as an attachment.
    const img = post.locator('img[src*="/uploads/media/"]');
    await expect(img).toHaveCount(1);
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
    await expect(composerEditor(page).locator('img[src]')).toHaveCount(2);
    await expect(composerEditor(page).locator('img[src^="data:"]')).toHaveCount(0);
  });

  test('shows upload progress and blocks posting while a pasted image is in flight', async ({
    page,
  }) => {
    // The fixture is a few KB over localhost — real uploads finish inside a
    // single event-loop turn, before the assertions below get a chance to
    // observe the "in flight" state. Delaying the response (not the request)
    // holds the upload open long enough to inspect it without faking any
    // behavior the real upload doesn't already have.
    await page.route('**/api/media/upload', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

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

  test('dropping a screenshot uploads it as an attachment instead of inlining base64', async ({
    page,
  }) => {
    // The regression this guards: drop had no interception at all, so Kerebron
    // inlined the image and the resulting post body blew past the API's 1 MB
    // limit — surfacing to the user as an unexplained "Failed to post".
    const postText = `Dropped screenshot ${Date.now()}`;
    await composerEditor(page).fill(postText);

    await dropFiles(page, [{ ...SCREENSHOT, name: 'dropped.png' }]);

    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);
    await expect(composerEditor(page).locator('img[src^="data:"]')).toHaveCount(0);
    await expect(composerEditor(page).locator('img[src]')).toHaveCount(1);
    await expect(composerEditor(page)).toContainText(postText);

    await submitPost(page);
    await switchToCardView(page);

    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 20000 });
    await expect(post.locator('img[src^="data:"]')).toHaveCount(0);

    const img = post.locator('img[src*="/uploads/media/"]');
    await expect(img).toHaveCount(1);
    await expect(img).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15000 })
      .toBeGreaterThan(0);
  });

  test('attachment chips are labelled with the name the user picked', async ({ page }) => {
    // Not the storage name the backend generates (`<userId>-<hex>.webp`), which
    // is what the chip and the stored attachment used to show.
    await pasteFiles(page, [{ ...SCREENSHOT, name: 'quarterly-chart.png' }]);
    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);

    // The extension can change — images are re-encoded to WebP on the way up —
    // so the assertion is on the stem the user would recognise.
    await expect(
      page.locator('button[aria-label^="Remove attachment"]').locator('..'),
    ).toContainText('quarterly-chart');
  });

  test('the inlined image keeps an accessible name once posted', async ({ page }) => {
    // Kerebron drops `alt` when it serializes an image node, so the filename is
    // restored on the way out — otherwise every pasted screenshot publishes
    // with no accessible name at all.
    const postText = `Alt text ${Date.now()}`;
    await composerEditor(page).fill(postText);
    await pasteFiles(page, [{ ...SCREENSHOT, name: 'sprint-board.png' }]);
    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);

    await submitPost(page);
    await switchToCardView(page);

    const post = postContainer(page, postText);
    await expect(post.locator('img[src*="/uploads/media/"]')).toHaveAttribute(
      'alt',
      /sprint-board/,
    );
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
