/**
 * Huddle — the edit composer survives a collaborative editor that won't load.
 *
 * Only the edit composer passes `collab` to RichEditor, and RichEditor builds
 * its collaborative kit behind a dynamic `import()` of the Yjs chunk. When that
 * chunk can't be fetched — a stale Vite dep hash in dev, a chunk missing from a
 * partial OTA bundle — RichEditor swallows the error and renders nothing, so
 * "Edit post" opened an empty bordered box: no toolbar, no post text, nothing
 * to type into. Posting was unaffected (the new-post composer never loads that
 * chunk), which is why this only ever showed up on edit.
 *
 * The fallback in MarkdownEditor notices the editor never appeared and remounts
 * it without collaboration. Live co-editing is the part that's lost; editing
 * the post keeps working.
 *
 * The failure is simulated by aborting the chunk request, which is what the
 * browser saw in the reported case.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  composerEditor,
  openComposer,
  postContainer,
  submitPost,
  switchToCardView,
} from './helpers';

test.describe('Huddle — edit composer without the collab chunk', () => {
  test.slow();

  test('falls back to the single-user editor, seeded with the post text', async ({ page }) => {
    const seed = `collab-fallback-${Date.now()}`;
    const appended = ' — edited without collab';

    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
    await composerEditor(page).fill(seed);
    await submitPost(page);
    await switchToCardView(page);

    const card = postContainer(page, seed).first();
    await expect(card).toBeVisible({ timeout: 15000 });

    // Break the collaborative kit the way a stale/missing chunk does.
    await page.route(/collabKit/, (route) => route.abort());

    await card
      .locator('button')
      .filter({ has: page.locator('circle') })
      .last()
      .click();
    await page.getByRole('button', { name: 'Edit post' }).click();

    // Pre-fix this never arrived — the composer rendered an empty box.
    const editor = composerEditor(page);
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    await expect(editor).toContainText(seed);

    // And it is a real editor: typing reaches the post.
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(appended);
    await page.getByRole('button', { name: 'Update post' }).click();

    await expect(postContainer(page, seed + appended).first()).toBeVisible({ timeout: 15000 });
  });
});
