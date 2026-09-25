/**
 * Huddle — inline HTML in a post's markdown.
 *
 * Markdown has no syntax for highlight, superscript or subscript, so the editor
 * writes them as `<mark>`, `<sup>` and `<sub>` — inline HTML, which markdown
 * permits and the editor reads back into the same marks.
 *
 * That road was closed until recently, and closed badly. Kerebron's markdown
 * reader turned an inline HTML tag into a *block* token holding just the tag
 * text, which the converter fed to DOMParser as an unclosed fragment and
 * imported as a block — discarding the whole line it appeared in. A post
 * reading "an update with <b>emphasis</b> that must not vanish" opened for
 * editing as an empty document, and because saving replaces a post's body with
 * the editor's contents, one keystroke and Update destroyed everything.
 *
 * So there are three things to hold in place here: the marks survive the whole
 * loop, inline HTML no longer empties the editor, and the raw HTML a post may
 * now carry is sanitized before it is rendered.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  composerEditor,
  openComposer,
  postContainer,
  rewriteStoredMarkdown,
  submitPost,
  switchToCardView,
} from './helpers';

/** Selects a single word in the editor, the way a double-click would. */
async function selectWord(page: import('@playwright/test').Page, word: string): Promise<void> {
  await page.evaluate((needle) => {
    const root = document.querySelector('.markdown-editor .ProseMirror');
    if (!root) return;
    // Walk every text node: applying a mark splits the paragraph's text, so the
    // word after the first one is no longer in the first child.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const at = node.textContent?.indexOf(needle) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
  }, word);
}

test.describe('Huddle — inline HTML in posts', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
  });

  test('highlight, superscript and subscript survive the whole round trip', async ({ page }) => {
    const stamp = `html-marks-${Date.now()}`;
    await openComposer(page);
    await composerEditor(page).click();
    await page.keyboard.type(`${stamp} HILITE SUPER SUBBY`);

    for (const [word, tool] of [
      ['HILITE', 'Toggle highlight'],
      ['SUPER', 'Toggle superscript'],
      ['SUBBY', 'Toggle subscript'],
    ]) {
      await selectWord(page, word);
      await page.locator(`.kb-custom-menu button[aria-label="${tool}"]`).click();
    }

    // In the editor
    const editor = composerEditor(page);
    await expect(editor.locator('mark')).toHaveText('HILITE');
    await expect(editor.locator('sup')).toHaveText('SUPER');
    await expect(editor.locator('sub')).toHaveText('SUBBY');

    await submitPost(page);
    await switchToCardView(page);

    // In the feed — the assertion that actually matters, since this is where
    // the marks used to disappear entirely.
    const post = postContainer(page, stamp);
    await expect(post.locator('mark')).toHaveText('HILITE');
    await expect(post.locator('sup')).toHaveText('SUPER');
    await expect(post.locator('sub')).toHaveText('SUBBY');

    // And back in the editor, so editing a post does not flatten them.
    await post.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit post' }).click();
    const reopened = composerEditor(page);
    await expect(reopened.locator('mark')).toHaveText('HILITE');
    await expect(reopened.locator('sup')).toHaveText('SUPER');
    await expect(reopened.locator('sub')).toHaveText('SUBBY');
  });

  test('a post containing inline HTML still opens with its text', async ({ page }) => {
    const seed = `html-keeps-${Date.now()}`;
    await openComposer(page);
    await composerEditor(page).fill(seed);
    await submitPost(page);

    await rewriteStoredMarkdown(
      seed,
      `${seed} an important update with <b>emphasis</b> that must not vanish`,
    );
    await page.reload();
    await switchToCardView(page);

    const card = postContainer(page, seed).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit post' }).click();

    // Every word, not just the ones outside the tags.
    const editor = composerEditor(page);
    await expect(editor).toContainText('an important update with');
    await expect(editor).toContainText('emphasis');
    await expect(editor).toContainText('that must not vanish');
    // The tag became formatting rather than being left as literal text.
    await expect(editor.locator('strong')).toHaveText('emphasis');
  });

  test('hostile HTML in a post is sanitized and does not run', async ({ page }) => {
    const seed = `html-xss-${Date.now()}`;
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });

    await openComposer(page);
    await composerEditor(page).fill(seed);
    await submitPost(page);

    await rewriteStoredMarkdown(
      seed,
      `${seed} <script>window.__pwned = 1</script>` +
        ` <img src=x onerror="window.__pwned = 1">` +
        ` <a href="javascript:alert('x')">link</a>` +
        ` <mark onclick="window.__pwned = 1">highlighted</mark>` +
        ` <iframe src="https://example.com"></iframe>` +
        ` <sup>ok</sup>`,
    );
    await page.reload();
    await switchToCardView(page);

    const post = postContainer(page, seed).first();
    await expect(post).toBeVisible({ timeout: 15000 });
    const rendered = await post.locator('.prose').first().innerHTML();

    for (const dangerous of [/<script/i, /onerror/i, /onclick/i, /javascript:/i, /<iframe/i]) {
      expect(rendered, `${dangerous} must not survive sanitizing`).not.toMatch(dangerous);
    }
    // The allowed tags still come through, so this is a filter and not a ban.
    expect(rendered).toMatch(/<mark>/);
    expect(rendered).toMatch(/<sup>/);

    expect(await page.evaluate(() => '__pwned' in window)).toBe(false);
    expect(dialogs).toBe(0);
  });
});
