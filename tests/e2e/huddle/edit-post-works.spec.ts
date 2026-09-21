/**
 * Huddle — "Edit post" opens a working editor.
 *
 * The edit composer used to be the only place that asked RichEditor for live
 * co-editing, and RichEditor builds that kit behind a dynamic `import()`. When
 * the chunk failed to load, RichEditor swallowed the error and rendered nothing
 * at all: the composer came up as an empty bordered box — no toolbar, no post
 * text, nothing to type into — and the post could not be edited. Writing new
 * posts was unaffected, since they never pass `collab` and never load it.
 *
 * Live co-editing is switched off until the component survives that failure
 * (see `src/features/huddle/collab.ts` and mieweb/ui#480), so this asserts both
 * halves of the fix: the composer never reaches for that chunk, and editing a
 * post works end to end.
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

test.describe('Huddle — editing a post', () => {
  test.slow();

  test('opens an editor seeded with the post, and saves what you type', async ({ page }) => {
    const seed = `edit-post-${Date.now()}`;
    const appended = ' — edited';

    // Every request for the collaborative kit, so the test fails if the edit
    // composer starts asking for it again while it is meant to be off.
    const collabChunkRequests: string[] = [];
    page.on('request', (request) => {
      if (/collabKit/.test(request.url())) collabChunkRequests.push(request.url());
    });

    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
    await composerEditor(page).fill(seed);
    await submitPost(page);
    await switchToCardView(page);

    const card = postContainer(page, seed).first();
    await expect(card).toBeVisible({ timeout: 15000 });

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

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(appended);
    await page.getByRole('button', { name: 'Update post' }).click();

    await expect(postContainer(page, seed + appended).first()).toBeVisible({ timeout: 15000 });
    expect(collabChunkRequests).toEqual([]);
  });
});
