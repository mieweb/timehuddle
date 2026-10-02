/**
 * Huddle Feed — Pulse Video Tests
 *
 * Verifies two ways a video ends up in a huddle post:
 *  1. Direct upload from the composer's attach bar ("Video" button) — a
 *     file-picker path through PulseVault TUS, independent of any ticket.
 *     Driven through the Clock tab's plan composer.
 *  2. Cross-posting: a ticket that already has a Pulse video attached is
 *     picked with the Huddle message box's Ticket button, and that video is
 *     automatically pulled into the post (useTicketVideos) without any extra
 *     upload step. Runs on a freshly created, empty team, so the inbox opens
 *     on its starter conversation.
 *
 * Both assert against the real backend — the post must link to the actual
 * /pulsevault/artifacts/:id playback URL (the inbox renders video attachments
 * as links), not just "some video exists".
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { createTicket, deleteTicket, uploadVideoToTicket, TEST_MP4 } from '../tickets/helpers';
import {
  attachTicket,
  clockOut,
  composerEditor,
  inboxComposer,
  openComposer,
  openPostInInbox,
  sendFromInbox,
  setSharedTeamPlanGate,
  submitPost,
} from './helpers';

/** Create a team through the UI; the app switches to it. */
async function createFreshTeam(page: Page, name: string): Promise<void> {
  await page.goto('/app/teams');
  await page.getByRole('button', { name: 'Create Team' }).click();
  await page.getByPlaceholder('Team name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });
}

test.describe('Huddle — direct video upload', () => {
  test.setTimeout(90000);

  test.beforeAll(() => setSharedTeamPlanGate(true));
  test.afterAll(() => setSharedTeamPlanGate(false));

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await openComposer(page);
  });

  test.afterEach(async ({ page }) => {
    await clockOut(page);
  });

  test("uploading a video via the composer's Video button posts a playable video", async ({
    page,
  }) => {
    const postText = `Huddle Video Post ${Date.now()}`;

    await composerEditor(page).fill(postText);

    await page.getByRole('button', { name: 'Video', exact: true }).click();
    const videoInput = page.locator('input[type="file"][accept="video/*"]');
    await videoInput.setInputFiles(TEST_MP4);

    // The attach bar shows the filename as a chip once uploadMedia() resolves.
    await expect(page.getByText('test-video.mp4')).toBeVisible({ timeout: 20000 });

    await submitPost(page);

    const post = await openPostInInbox(page, postText);
    await expect(post.locator('a[href*="/pulsevault/artifacts/"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe('Huddle — ticket video cross-posting', () => {
  test.setTimeout(120000);

  const TICKET_TITLE = `Huddle Cross-post Ticket ${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    // "Test Team" prefix: global teardown only removes orphaned teams named that way.
    await createFreshTeam(page, `Test Team Cross-post ${Date.now()}`);
    await createTicket(page, TICKET_TITLE);
    await uploadVideoToTicket(page, TICKET_TITLE);
  });

  test.afterEach(async ({ page }) => {
    await deleteTicket(page, TICKET_TITLE);
  });

  test("a ticket's attached Pulse video is pulled into the post when the ticket is attached", async ({
    page,
  }) => {
    await page.goto('/app/huddle');
    await inboxComposer(page).waitFor({ state: 'visible', timeout: 20000 });

    const postText = `Huddle Cross-post Test ${Date.now()}`;
    await inboxComposer(page).fill(postText);

    await attachTicket(page, TICKET_TITLE);

    // The video is pulled in automatically the moment the ticket is picked —
    // this is the behavior under test, and it must be visible before posting.
    await expect(page.getByText('(from ticket)')).toBeVisible({ timeout: 10000 });

    await sendFromInbox(page);

    const post = await openPostInInbox(page, postText);
    await expect(post.locator('a[href*="/pulsevault/artifacts/"]')).toBeVisible({
      timeout: 10000,
    });
  });
});
