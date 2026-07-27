/**
 * Huddle Feed — Pulse Video Tests
 *
 * Verifies two ways a video ends up playable in a huddle post:
 *  1. Direct upload from the composer's AttachmentBar ("Video" button) — a
 *     file-picker path through PulseVault TUS, independent of any ticket.
 *  2. Cross-posting: a ticket that already has a Pulse video attached is
 *     picked via the composer's TicketPicker, and that video is
 *     automatically pulled into the post (HuddleComposer.tsx's `ticketVideos`
 *     state) without any extra upload step.
 *
 * Both assert against the real backend — the post's <video src> must
 * resolve to the actual /pulsevault/artifacts/:id playback URL, not just
 * "some video element exists".
 */
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTicket, deleteTicket, uploadVideoToTicket, TEST_MP4 } from '../tickets/helpers';

/**
 * The composer's editable surface. Kerebron's RichEditor renders a ProseMirror
 * contenteditable rather than a <textarea>, so there is no placeholder
 * attribute to select on — the visible prompt is a CSS `::before`.
 */
function composerEditor(page: import('@playwright/test').Page) {
  return page.locator('.markdown-editor .ProseMirror').first();
}

async function goToHuddle(page: import('@playwright/test').Page) {
  await page.goto('/app/huddle');
  // The composer starts collapsed (a "Share an update..." prompt) — click it
  // to expand into the full editor + toolbar view.
  await page.getByText('Share an update...').click();
  await composerEditor(page).waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * The feed defaults to chat view, where non-image attachments render as plain
 * links by design (see superChatFeed.ts). Inline <video> playback lives in card
 * view, so switch there before asserting on it.
 */
async function switchToCardView(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Switch to card view' }).click();
}

/** Locates a post's root container by the unique text in its body. */
function postContainer(page: import('@playwright/test').Page, uniqueText: string) {
  return page.locator('div.border-b.px-5.pt-4').filter({ hasText: uniqueText });
}

test.describe('Huddle — direct video upload', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await goToHuddle(page);
  });

  test("uploading a video via the composer's Video button posts a playable video", async ({
    page,
  }) => {
    const postText = `Huddle Video Post ${Date.now()}`;

    await composerEditor(page).fill(postText);

    await page.getByRole('button', { name: 'Video', exact: true }).click();
    const videoInput = page.locator('input[type="file"][accept="video/*"]');
    await videoInput.setInputFiles(TEST_MP4);

    // AttachmentBar shows the filename as a chip once uploadMedia() resolves.
    await expect(page.getByText('test-video.mp4')).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'Post', exact: true }).click();

    await switchToCardView(page);

    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 10000 });
    await expect(post.locator('video[src*="/pulsevault/artifacts/"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Huddle — ticket video cross-posting', () => {
  test.setTimeout(120000);

  const TICKET_TITLE = `Huddle Cross-post Ticket ${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, TICKET_TITLE);
    await uploadVideoToTicket(page, TICKET_TITLE);
  });

  test.afterEach(async ({ page }) => {
    await deleteTicket(page, TICKET_TITLE);
  });

  test("a ticket's attached Pulse video is pulled into the post when the ticket is attached", async ({
    page,
  }) => {
    await goToHuddle(page);

    const postText = `Huddle Cross-post Test ${Date.now()}`;
    await composerEditor(page).fill(postText);

    await page.getByRole('button', { name: 'Ticket', exact: true }).click();
    await page.getByPlaceholder('Search tickets...').fill(TICKET_TITLE);
    await page.getByRole('button').filter({ hasText: TICKET_TITLE }).first().click();

    // The video is pulled in automatically the moment the ticket is picked —
    // this is the behavior under test, and it must be visible before posting.
    await expect(page.getByText('(from ticket)')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Post', exact: true }).click();

    await switchToCardView(page);

    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 10000 });
    await expect(post.locator('video[src*="/pulsevault/artifacts/"]')).toBeVisible({
      timeout: 10000,
    });
  });
});
