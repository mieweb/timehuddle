/**
 * Huddle Composer — what happens when an attachment or a post doesn't make it.
 *
 * These paths used to be the worst part of the composer. A failed post raised a
 * browser `alert()` reading "Failed to post. Please try again." whatever had
 * actually gone wrong; an over-limit body died as a phantom CORS error; and a
 * dropped file the editor didn't recognise vanished with no attachment, no
 * message and no trace.
 *
 * So each test here asserts two things: the writer is *told* something specific,
 * and the draft is still there afterwards. The second half is the reason the
 * alert had to go — dismissing it cost you the caret, and on mobile the
 * keyboard along with it.
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  attachmentChipCount,
  composerEditor,
  dropFiles,
  openComposer,
  submitPost,
} from './helpers';

/** The composer's inline `role="alert"` region. */
const errorRegion = (page: import('@playwright/test').Page) => page.getByTestId('composer-error');

test.describe('Huddle composer — failures are visible', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
  });

  test('a file the backend will not take is reported by name', async ({ page }) => {
    const draft = `Unsupported drop ${Date.now()}`;
    await composerEditor(page).fill(draft);

    await dropFiles(page, [{ text: 'PK', name: 'archive.zip', type: 'application/zip' }]);

    // Named: a partial batch is otherwise unreadable — files go in, fewer chips
    // come out, and nothing says which one is missing.
    await expect(errorRegion(page)).toContainText('archive.zip', { timeout: 30000 });
    await expect(errorRegion(page)).toContainText(/unsupported/i);
    expect(await attachmentChipCount(page)).toBe(0);
    await expect(composerEditor(page)).toContainText(draft);
  });

  test('a dropped document attaches instead of disappearing', async ({ page }) => {
    // The regression: a PDF matched neither the composer's media filter nor
    // Kerebron's, so it hit a contenteditable whose dragover had already been
    // cancelled and was swallowed — no chip, no error, nothing at all.
    await dropFiles(page, [{ text: '%PDF-1.4', name: 'spec.pdf', type: 'application/pdf' }]);

    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);
    await expect(errorRegion(page)).toHaveCount(0);
  });

  test('a post rejected as too large says so, and keeps the draft', async ({ page }) => {
    // Stubbed rather than built: the real trigger is a >1 MB body, and pasting
    // a megabyte of text to prove the mapping costs seconds per run. What is
    // under test is that the API's `payload-too-large` becomes a sentence.
    await page.route('**/huddle_createPost', (route) =>
      route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'payload-too-large', message: 'Request body is 4.2 MB.' }),
      }),
    );

    const draft = `Too large ${Date.now()}`;
    await composerEditor(page).fill(draft);
    await page.getByRole('button', { name: 'Post', exact: true }).click();

    await expect(errorRegion(page)).toContainText(/too large/i, { timeout: 30000 });
    // The API's own byte arithmetic is not an instruction — the writer is told
    // what to do about it.
    await expect(errorRegion(page)).not.toContainText('4.2 MB');
    await expect(composerEditor(page)).toContainText(draft);
  });

  test('a post that cannot reach the server says so, and keeps the draft', async ({ page }) => {
    await page.route('**/huddle_createPost', (route) => route.abort('failed'));

    const draft = `Offline ${Date.now()}`;
    await composerEditor(page).fill(draft);
    await page.getByRole('button', { name: 'Post', exact: true }).click();

    // Not "Failed to fetch", which is what the transport actually threw.
    await expect(errorRegion(page)).toContainText(/connection/i, { timeout: 30000 });
    await expect(composerEditor(page)).toContainText(draft);
  });

  test('the notice clears once the post goes through', async ({ page }) => {
    let failed = false;
    await page.route('**/huddle_createPost', async (route) => {
      if (failed) return route.continue();
      failed = true;
      return route.abort('failed');
    });

    const draft = `Recovers ${Date.now()}`;
    await composerEditor(page).fill(draft);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(errorRegion(page)).toBeVisible({ timeout: 30000 });

    // Retrying from the draft the failure left intact is the whole point.
    await submitPost(page);
    await expect(errorRegion(page)).toHaveCount(0, { timeout: 30000 });
  });
});
