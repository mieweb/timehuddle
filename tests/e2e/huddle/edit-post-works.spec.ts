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
 * Live co-editing is on again, because our @mieweb/ui fork now survives that
 * failure: `createEditorKits` catches the failed import, reports it through
 * `collab.onUnavailable`, and falls back to a plain local editor. So the guard
 * is no longer "never load that chunk" — it is that editing a post works
 * whether or not the chunk arrives. The second test proves the fallback by
 * blocking it outright.
 */
import { MongoClient } from 'mongodb';
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

/**
 * Rewrites a post's stored markdown, to set up content the composer cannot
 * produce itself — the editor escapes HTML typed into it, so raw inline HTML
 * can only arrive from somewhere else (an import, the REST bridge, a paste).
 * Mirrors global-setup's own access to the test database.
 */
async function rewriteStoredMarkdown(match: string, markdown: string): Promise<void> {
  const url = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
  if (!/_test(\?|$)/.test(new URL(url).pathname + (new URL(url).search || ''))) {
    throw new Error('refusing to write to a database that is not the test one');
  }
  const client = await MongoClient.connect(url);
  try {
    await client
      .db()
      .collection('huddlePosts')
      .updateOne({ 'content.text': { $regex: match } }, { $set: { 'content.text': markdown } });
  } finally {
    await client.close();
  }
}

test.describe('Huddle — editing a post', () => {
  test.slow();

  test('opens an editor seeded with the post, and saves what you type', async ({ page }) => {
    const seed = `edit-post-${Date.now()}`;
    const appended = ' — edited';

    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
    await composerEditor(page).fill(seed);
    await submitPost(page);
    await switchToCardView(page);

    const card = postContainer(page, seed).first();
    await expect(card).toBeVisible({ timeout: 15000 });

    // Both of these broke in dbaa9b09, which swapped the hand-rolled menu for
    // @mieweb/ui's Dropdown: the kebab became a FontAwesome <path> (this used
    // to filter for a <circle>) and the entries became menuitems rather than
    // buttons. Select by accessible name and role, not by markup internals —
    // HuddlePage.openPostMenu already locates the trigger this way.
    await card.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit post' }).click();

    // Pre-fix this never arrived — the composer rendered an empty box.
    const editor = composerEditor(page);
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    await expect(editor).toContainText(seed);

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(appended);
    await page.getByRole('button', { name: 'Update post' }).click();

    await expect(postContainer(page, seed + appended).first()).toBeVisible({ timeout: 15000 });
  });

  test('refuses to overwrite a post it could not load', async ({ page }) => {
    // A post whose markdown carries inline HTML comes up EMPTY in the editor —
    // the whole line is discarded, not just the tags (a defect in Kerebron's
    // markdown reader). Saving replaces a post's body with the editor's
    // contents, so one keystroke and Update used to destroy everything that was
    // there, silently. The composer now refuses rather than overwrite.
    const seed = `edit-guard-${Date.now()}`;
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
    await composerEditor(page).fill(seed);
    await submitPost(page);

    const original = `${seed} an important update with <b>emphasis</b> that must not vanish`;
    await rewriteStoredMarkdown(seed, original);
    await page.reload();
    await switchToCardView(page);

    const card = postContainer(page, seed).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit post' }).click();

    const editor = composerEditor(page);
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    await expect(page.getByTestId('composer-error')).toContainText('could not be loaded');

    // Even after typing — which is what re-enables the button normally — the
    // save stays shut, because what would be written is not the post.
    await editor.click();
    await page.keyboard.type('typo fix');
    await expect(page.getByRole('button', { name: 'Update post' })).toBeDisabled();
  });

  test('still edits a post when the collaborative kit cannot be loaded', async ({ page }) => {
    const seed = `edit-nocollab-${Date.now()}`;
    const appended = ' — edited offline';

    // The failure that made us switch co-editing off in the first place: the
    // Yjs kit is a lazy chunk, so a stale deploy, a cold cache or a flaky
    // network can make it simply not arrive. Block it outright.
    await page.route(/collabKit/, (route) => route.abort());

    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('live co-editing unavailable')) warnings.push(message.text());
    });

    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
    await composerEditor(page).fill(seed);
    await submitPost(page);
    await switchToCardView(page);

    const card = postContainer(page, seed).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit post' }).click();

    // The whole point: an editor, seeded, not an empty bordered box.
    const editor = composerEditor(page);
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    await expect(editor).toContainText(seed);

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(appended);
    await page.getByRole('button', { name: 'Update post' }).click();
    await expect(postContainer(page, seed + appended).first()).toBeVisible({ timeout: 15000 });

    // And the host was told, rather than left guessing from the DOM.
    expect(warnings.length).toBeGreaterThan(0);
  });
});
