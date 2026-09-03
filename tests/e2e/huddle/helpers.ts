/**
 * Shared helpers for the Huddle composer/feed specs.
 *
 * Every huddle spec needs the same four things — open the composer, drive one
 * of its attach actions, switch the feed to the view that renders attachments
 * inline, and find a post by its unique body text — so they live here rather
 * than being re-derived (slightly differently) in each file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

/** Real fixture files, uploaded through the actual backend endpoints. */
export const FIXTURE = {
  image: path.join(FIXTURES_DIR, 'test-image.png'),
  doc: path.join(FIXTURES_DIR, 'test-doc.txt'),
  video: path.join(FIXTURES_DIR, 'test-video.mp4'),
};

/**
 * The composer's editable surface. Kerebron's RichEditor renders a ProseMirror
 * contenteditable rather than a <textarea>, so there is no placeholder
 * attribute to select on — the visible prompt is a CSS `::before`.
 */
export function composerEditor(page: Page) {
  return page.locator('.markdown-editor .ProseMirror').first();
}

/** Navigate to the huddle feed and expand the (initially collapsed) composer. */
export async function openComposer(page: Page): Promise<void> {
  await page.goto('/app/huddle');
  await page.waitForLoadState('networkidle');
  await page.getByText('Share an update...').click();
  await composerEditor(page).waitFor({ state: 'visible', timeout: 20000 });
}

/**
 * The feed defaults to chat view, where non-image attachments render as plain
 * links by design (see superChatFeed.ts). Inline <video>/<img> playback lives
 * in card view, so switch there before asserting on it.
 */
export async function switchToCardView(page: Page): Promise<void> {
  const toCardButton = page.getByRole('button', { name: 'Switch to card view' });
  if (await toCardButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await toCardButton.click();
    await page.getByRole('button', { name: 'Switch to chat view' }).waitFor({ timeout: 5000 });
  }
}

/** Locates a post's root container by the unique text in its body. */
export function postContainer(page: Page, uniqueText: string) {
  return page.locator('[data-testid="post-card"]').filter({ hasText: uniqueText });
}

/**
 * Attach a file through one of the composer's hidden file inputs and wait for
 * its chip to appear.
 *
 * `setInputFiles` on the hidden input rather than clicking the visible button
 * first: the click only forwards to the same input, and a real OS file dialog
 * isn't drivable anyway.
 */
export async function attachFile(page: Page, kind: 'image' | 'doc' | 'video'): Promise<void> {
  const accept = {
    image: 'input[type="file"][accept="image/*"]',
    doc: 'input[type="file"][accept=".pdf,.doc,.docx,.txt"]',
    video: 'input[type="file"][accept="video/*"]',
  }[kind];

  const chipsBefore = await attachmentChipCount(page);
  await page.locator(accept).setInputFiles(FIXTURE[kind]);

  // Video goes through a TUS upload of a ~770KB fixture, which is slower than
  // the single multipart POST images and docs take.
  await expect
    .poll(() => attachmentChipCount(page), { timeout: kind === 'video' ? 60000 : 20000 })
    .toBe(chipsBefore + 1);
}

/** How many attachment chips the composer is currently showing. */
export function attachmentChipCount(page: Page): Promise<number> {
  return page.locator('button[aria-label^="Remove attachment"]').count();
}

/**
 * Paste image files into the composer, the way ⌘V of a screenshot does.
 *
 * Playwright can't put an image on the real OS clipboard, so this dispatches
 * the `paste` event the browser would: a `ClipboardEvent` carrying a
 * `DataTransfer` of `File`s, fired at the ProseMirror surface. The composer's
 * handler is a *capture*-phase listener on the `.markdown-editor` wrapper, so
 * dispatching at the inner target still reaches it on the way down — exactly
 * the ordering the real thing relies on to beat ProseMirror's own handler.
 */
export async function pasteFiles(
  page: Page,
  files: Array<{ fixture: string; name: string; type: string }>,
): Promise<void> {
  const payload = files.map((f) => ({
    base64: fs.readFileSync(f.fixture).toString('base64'),
    name: f.name,
    type: f.type,
  }));

  await page.evaluate(async (items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const blob = await (await fetch(`data:${item.type};base64,${item.base64}`)).blob();
      transfer.items.add(new File([blob], item.name, { type: item.type }));
    }
    const target = document.querySelector('.markdown-editor .ProseMirror');
    if (!target) throw new Error('composer editor not found');
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, payload);
}

/** Paste plain text, to prove the image interception leaves normal pastes alone. */
export async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    const target = document.querySelector('.markdown-editor .ProseMirror');
    if (!target) throw new Error('composer editor not found');
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, text);
}

/** Pick a team member in the @Mention menu. */
export async function mentionMember(page: Page, memberName: string): Promise<void> {
  await page.getByRole('button', { name: '@Mention', exact: true }).click();
  await page.getByTestId('mention-menu').waitFor({ state: 'visible', timeout: 10000 });
  await page
    .getByTestId('mention-menu')
    .getByRole('menuitem')
    .filter({ hasText: memberName })
    .first()
    .click();
  await expect(page.locator(`button[aria-label="Remove mention of ${memberName}"]`)).toBeVisible();
}

/** Pick a ticket in the Ticket menu, searching by title. */
export async function attachTicket(page: Page, ticketTitle: string): Promise<void> {
  await page.getByRole('button', { name: 'Ticket', exact: true }).click();
  await page.getByTestId('ticket-picker-menu').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByPlaceholder('Search tickets...').fill(ticketTitle);
  await page
    .getByTestId('ticket-picker-menu')
    .getByRole('menuitem')
    .filter({ hasText: ticketTitle })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Remove ticket' })).toBeVisible();
}

/** Submit the composer and wait for the progress bar to clear. */
export async function submitPost(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page
    .locator('[data-testid="post-progress-bar"]')
    .waitFor({ state: 'hidden', timeout: 30000 });
}
