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
 *
 * Attachment failures are driven through the Clock tab's plan composer (the
 * shared editor + attach bar); post failures through the Huddle page's "Share
 * an update…" composer, the one place to post there (the inbox is read-only).
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { createTicket, deleteTicket } from '../tickets/helpers';
import {
  attachTicket,
  attachmentChipCount,
  composerEditor,
  dropFiles,
  inboxComposer,
  inboxMessage,
  openPostInInbox,
  openComposer,
  postFromHuddle as send,
  sendFromInbox,
  setSharedTeamPlanGate,
} from './helpers';

/** The composer's inline `role="alert"` region. */
const errorRegion = (page: Page) => page.getByTestId('composer-error');

test.describe('Huddle composer — attachment failures are visible', () => {
  test.setTimeout(120000);

  test.beforeAll(() => setSharedTeamPlanGate(true));
  test.afterAll(() => setSharedTeamPlanGate(false));

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
});

test.describe('Huddle message box — post failures are visible', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
  });

  test('rapid clicks on a ticket-backed send create only one post', async ({ page }) => {
    const ticketTitle = `Duplicate send ticket ${Date.now()}`;
    await createTicket(page, ticketTitle);
    await page.goto('/app/huddle');
    await attachTicket(page, ticketTitle);

    const draft = `Duplicate send ${Date.now()}`;
    await inboxComposer(page).fill(draft);

    let postRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/huddle_createPost')) postRequests++;
    });

    // Dispatch both clicks before React can render isSending; this exercises
    // the synchronous re-entry guard with the ticket keeping send available.
    await page.getByRole('button', { name: 'Send message' }).evaluate((button) => {
      const click = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      click();
      click();
    });

    const post = await openPostInInbox(page, draft);
    await expect(post).toContainText(ticketTitle);
    await expect(inboxMessage(page, draft)).toHaveCount(1);
    expect(postRequests).toBe(1);

    await deleteTicket(page, ticketTitle);
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
    await send(page, draft);

    await expect(errorRegion(page)).toContainText(/too large/i, { timeout: 30000 });
    // The API's own byte arithmetic is not an instruction — the writer is told
    // what to do about it.
    await expect(errorRegion(page)).not.toContainText('4.2 MB');
    await expect(inboxComposer(page)).toHaveValue(draft);
  });

  test('a post that cannot reach the server says so, and keeps the draft', async ({ page }) => {
    await page.route('**/huddle_createPost', (route) => route.abort('failed'));

    const draft = `Offline ${Date.now()}`;
    await send(page, draft);

    // Not "Failed to fetch", which is what the transport actually threw.
    await expect(errorRegion(page)).toContainText(/connection/i, { timeout: 30000 });
    await expect(inboxComposer(page)).toHaveValue(draft);
  });

  test('the notice clears once the post goes through', async ({ page }) => {
    let failed = false;
    await page.route('**/huddle_createPost', async (route) => {
      if (failed) return route.continue();
      failed = true;
      return route.abort('failed');
    });

    const draft = `Recovers ${Date.now()}`;
    await send(page, draft);
    await expect(errorRegion(page)).toBeVisible({ timeout: 30000 });

    // Retrying from the draft the failure left intact is the whole point.
    await expect(inboxComposer(page)).toHaveValue(draft);
    await sendFromInbox(page);
    await expect(errorRegion(page)).toHaveCount(0, { timeout: 30000 });
  });
});
