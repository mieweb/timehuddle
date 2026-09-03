/**
 * Huddle Composer — every attach action, alone and combined.
 *
 * One test per composer action (photo, doc, mention, ticket) plus a combined
 * post carrying all of them at once, because the actions share state in
 * HuddleComposer (attachments, mentions, selectedTicketId, ticketVideos) and
 * regressions have historically shown up only when several are set together.
 *
 * Video gets its own file (pulsevault-video.spec.ts) — it goes through the TUS
 * upload path rather than the multipart media endpoint — but the combined post
 * here includes one, since "photo + video + mention in one post" is exactly the
 * case that exercises every branch of `toPostAttachment` at once.
 *
 * Assertions go against the real backend: an attached image must come back as
 * an <img> whose src actually resolves, not merely as "an img element exists".
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { createTicket, deleteTicket } from '../tickets/helpers';
import {
  FIXTURE,
  attachFile,
  attachTicket,
  attachmentChipCount,
  composerEditor,
  mentionMember,
  openComposer,
  postContainer,
  submitPost,
  switchToCardView,
} from './helpers';

/** Fetches an attachment URL from inside the page and reports its status. */
async function fetchStatus(page: Page, url: string): Promise<number> {
  return page.evaluate(async (u) => {
    const res = await fetch(u, { method: 'GET' });
    return res.status;
  }, url);
}

test.describe('Huddle composer — individual actions', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
  });

  test('posts text only', async ({ page }) => {
    const postText = `Text only ${Date.now()}`;
    await composerEditor(page).fill(postText);
    await submitPost(page);

    await switchToCardView(page);
    await expect(postContainer(page, postText)).toBeVisible({ timeout: 15000 });
  });

  test('posts a photo that is served back by the backend', async ({ page }) => {
    const postText = `Photo post ${Date.now()}`;
    await composerEditor(page).fill(postText);
    await attachFile(page, 'image');
    await submitPost(page);

    await switchToCardView(page);
    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 15000 });

    const img = post.locator('img[src*="/uploads/media/"]');
    await expect(img).toBeVisible({ timeout: 10000 });

    // naturalWidth is the real proof: a broken src still renders an <img>, but
    // only a decoded image has non-zero intrinsic dimensions. (Deliberately not
    // a fetch() of the same URL — the browser has already cached the <img>'s
    // no-cors response, which a subsequent cross-origin fetch cannot reuse.)
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10000 })
      .toBeGreaterThan(0);
  });

  test('posts a document as a downloadable link', async ({ page }) => {
    const postText = `Doc post ${Date.now()}`;
    await composerEditor(page).fill(postText);
    await attachFile(page, 'doc');
    await submitPost(page);

    await switchToCardView(page);
    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 15000 });

    const link = post.locator('a[download][href*="/uploads/media/"]');
    await expect(link).toBeVisible({ timeout: 10000 });
    expect(await fetchStatus(page, (await link.getAttribute('href'))!)).toBe(200);
  });

  test('posts with an @mention of a teammate', async ({ page }) => {
    const postText = `Mention post ${Date.now()}`;
    await composerEditor(page).fill(postText);
    await mentionMember(page, TEST_USERS.member1.name);
    await submitPost(page);

    await switchToCardView(page);
    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 15000 });
    await expect(post).toContainText(`@${TEST_USERS.member1.name}`);
  });

  test('a removed attachment is left out of the post', async ({ page }) => {
    const postText = `Removed attachment ${Date.now()}`;
    await composerEditor(page).fill(postText);

    // Attach two, drop one — the survivor must be the one that posts. Removing
    // the *first* of two on purpose: dropping the last chip can pass against an
    // off-by-one in the filter, dropping a middle/leading one cannot.
    await attachFile(page, 'image');
    await attachFile(page, 'doc');
    await page.locator('button[aria-label^="Remove attachment"]').first().click();
    await expect.poll(() => attachmentChipCount(page)).toBe(1);

    await submitPost(page);
    await switchToCardView(page);

    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 15000 });
    await expect(post.locator('a[download][href*="/uploads/media/"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(post.locator('img[src*="/uploads/media/"]')).toHaveCount(0);
  });

  test('posts with a ticket attached', async ({ page }) => {
    const ticketTitle = `Composer Ticket ${Date.now()}`;
    await createTicket(page, ticketTitle);
    await openComposer(page);

    const postText = `Ticket post ${Date.now()}`;
    await composerEditor(page).fill(postText);
    await attachTicket(page, ticketTitle);
    await submitPost(page);

    await switchToCardView(page);
    const post = postContainer(page, ticketTitle);
    await expect(post).toBeVisible({ timeout: 15000 });
    await expect(post).toContainText(postText);

    await deleteTicket(page, ticketTitle);
  });
});

test.describe('Huddle composer — combined actions', () => {
  test.setTimeout(180000);

  test('posts photo + doc + video + mention + ticket in one post', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);

    const ticketTitle = `Combo Ticket ${Date.now()}`;
    await createTicket(page, ticketTitle);
    await openComposer(page);

    const postText = `Everything at once ${Date.now()}`;
    await composerEditor(page).fill(postText);

    await attachFile(page, 'image');
    await attachFile(page, 'doc');
    await attachFile(page, 'video');
    await mentionMember(page, TEST_USERS.member1.name);
    await attachTicket(page, ticketTitle);

    // All three uploads survived each other — an upload starting while another
    // is settling used to clobber the earlier chip.
    await expect(page.locator('button[aria-label^="Remove attachment"]')).toHaveCount(3);

    await submitPost(page);

    await switchToCardView(page);
    const post = postContainer(page, postText);
    await expect(post).toBeVisible({ timeout: 20000 });

    await expect(post.locator('img[src*="/uploads/media/"]')).toBeVisible({ timeout: 15000 });
    await expect(post.locator('a[download][href*="/uploads/media/"]')).toBeVisible();
    await expect(post.locator('video[src*="/pulsevault/artifacts/"]')).toBeVisible();
    await expect(post).toContainText(`@${TEST_USERS.member1.name}`);
    await expect(post).toContainText(ticketTitle);

    await deleteTicket(page, ticketTitle);
  });
});

test.describe('Huddle composer — upload progress', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
  });

  test('shows a progress bar while a video uploads and blocks posting until it lands', async ({
    page,
  }) => {
    await composerEditor(page).fill(`Upload progress ${Date.now()}`);

    const progressBar = page.locator('[data-testid="post-progress-bar"]');
    const progressVisible = progressBar.waitFor({ state: 'visible', timeout: 20000 });

    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(FIXTURE.video);
    await progressVisible;

    // Upload phase is determinate and labelled distinctly from the post phase.
    await expect(progressBar).toHaveAttribute('aria-label', 'Uploading attachment');
    await expect(progressBar).toHaveAttribute('aria-valuenow', /\d+/);

    // Submitting mid-upload would strand the half-uploaded attachment.
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled();

    await expect(page.locator('button[aria-label^="Remove attachment"]')).toHaveCount(1, {
      timeout: 60000,
    });
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled();
  });

  test('the Video button reports its own upload state', async ({ page }) => {
    await composerEditor(page).fill(`Video button state ${Date.now()}`);
    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(FIXTURE.video);

    // The pressed button becomes the busy one, so it's clear *which* attachment
    // is in flight when several kinds are available.
    const busy = page.locator('button[aria-busy="true"]');
    await expect(busy).toHaveText(/Uploading/, { timeout: 20000 });
    await expect(page.locator('button[aria-label^="Remove attachment"]')).toHaveCount(1, {
      timeout: 60000,
    });
  });
});
