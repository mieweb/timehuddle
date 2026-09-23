/**
 * Huddle composer — the formatting toolbar.
 *
 * Two failures this guards against, both from the audit in #564.
 *
 * 1. **The dropdowns did nothing.** Type, Heading and Lists open a menu whose
 *    rows are a `display: none` button plus a visible label, and the click on
 *    the label is forwarded to that button with a `MouseEvent` built around
 *    dnt's `globalThis` *Proxy* — which fails WebIDL's `Window` brand check, so
 *    the constructor threw and the command never ran. Our RichEditor fork
 *    forwards the click itself; these tests fail if that regresses.
 *
 * 2. **The toolbar offered formatting that could not be saved.** Posts persist
 *    as markdown, which has no underline, highlight, superscript, subscript or
 *    block alignment: applied, they survived in the live document and vanished
 *    on the next round trip — underline worst of all, coming back as *italic*.
 *    Those tools are out of the kit now, so the assertion is that the toolbar
 *    does not offer them at all.
 *
 * The round-trip is the point, so every formatting assertion runs against the
 * *published* post, not the editor. Formatting that only survives until submit
 * is exactly the bug.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  composerEditor,
  openComposer,
  postContainer,
  submitPost,
  switchToCardView,
} from './helpers';

/** Selects the paragraph holding `text`, the way a user drags across a line. */
async function selectLine(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const root = document.querySelector('.markdown-editor .ProseMirror');
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.includes(needle)) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, node.textContent.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
  }, text);
}

/**
 * Opens a toolbar dropdown and clicks one of its rows.
 *
 * The row's label is what a user clicks — the button beside it is
 * `display: none`, so Playwright's normal locator click would be refused as
 * invisible. That asymmetry is the bug this file exists for, so the test drives
 * the same pixels a person would.
 */
async function pickFromMenu(page: Page, menu: string, item: string): Promise<void> {
  await page.locator(`.kb-custom-menu button[aria-label="${menu}"]`).click();
  const row = page.locator('.kb-custom-menu__overflow-item-label', { hasText: item }).first();
  await row.waitFor({ state: 'attached', timeout: 5000 });
  const box = await row.boundingBox();
  if (!box) throw new Error(`"${item}" in the ${menu} menu has no box to click`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Huddle composer — toolbar', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
  });

  test('the Heading menu applies a heading that survives posting', async ({ page }) => {
    const stamp = `toolbar-heading-${Date.now()}`;
    await composerEditor(page).click();
    await page.keyboard.type(stamp);

    await selectLine(page, stamp);
    await pickFromMenu(page, 'Heading', 'Heading 2');
    await expect(composerEditor(page).locator('h2')).toHaveText(stamp);

    await submitPost(page);
    await switchToCardView(page);
    await expect(postContainer(page, stamp).locator('h2')).toHaveText(stamp);
  });

  test('the Lists menu applies a bullet list that survives posting', async ({ page }) => {
    const stamp = `toolbar-list-${Date.now()}`;
    await composerEditor(page).click();
    await page.keyboard.type(stamp);

    await selectLine(page, stamp);
    await pickFromMenu(page, 'Lists', 'Bullet List');
    await expect(composerEditor(page).locator('ul li')).toHaveText(stamp);

    await submitPost(page);
    await switchToCardView(page);
    await expect(postContainer(page, stamp).locator('ul li')).toHaveText(stamp);
  });

  test('bold and italic survive posting', async ({ page }) => {
    const stamp = `toolbar-marks-${Date.now()}`;
    await composerEditor(page).click();
    await page.keyboard.type(stamp);

    await selectLine(page, stamp);
    await page.locator('.kb-custom-menu button[aria-label="Toggle bold"]').click();
    await selectLine(page, stamp);
    await page.locator('.kb-custom-menu button[aria-label="Toggle italic"]').click();

    await submitPost(page);
    await switchToCardView(page);
    const post = postContainer(page, stamp);
    await expect(post.locator('strong')).toHaveText(stamp);
    await expect(post.locator('em')).toHaveText(stamp);
  });

  test('offers no formatting the markdown round trip would discard', async ({ page }) => {
    const toolbar = page.locator('.kb-custom-menu button');
    await expect(toolbar.first()).toBeVisible();

    const labels = await toolbar.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    );

    for (const unsupported of [
      'Toggle underline',
      'Toggle highlight',
      'Toggle superscript',
      'Toggle subscript',
      'Align left',
      'Align center',
      'Align right',
      'Justify',
    ]) {
      expect(
        labels,
        `${unsupported} cannot survive markdown and must not be offered`,
      ).not.toContain(unsupported);
    }

    // The tools that do round-trip are still there — this is a narrowing, not a
    // gutting of the toolbar.
    expect(labels).toEqual(expect.arrayContaining(['Toggle bold', 'Toggle italic', 'Heading']));
  });

  test('the editor is named and described for screen readers', async ({ page }) => {
    const editor = composerEditor(page);
    await expect(editor).toHaveAttribute('role', 'textbox');
    await expect(editor).toHaveAttribute('aria-label', 'Write a post');

    const describedBy = await editor.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText("What's on your mind?");
  });

  test('Ctrl+` does not open the ProseMirror dev toolkit', async ({ page }) => {
    await composerEditor(page).click();
    await page.keyboard.press('Control+`');
    await expect(page.locator('.__prosemirror-dev-toolkit__')).toHaveCount(0);
  });
});
