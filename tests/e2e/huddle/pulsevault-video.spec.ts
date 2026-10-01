/**
 * Huddle Feed — Pulse Video Tests
 *
 * Videos reach a huddle post only through Pulse:
 *  1. The composer (driven through the Clock tab's plan composer) offers
 *     Pulse beside Post, and no raw "Video" file picker.
 *  1b. A Pulse upload lands where it was reserved for, with no client step:
 *     a Huddle post, a plan that clocks in, a wrap-up that clocks out — and
 *     one whose destination is gone by then is kept in the library instead.
 *     Removing it from the library leaves it playing where it was posted.
 *  2. Cross-posting: a ticket that already has a Pulse video attached is
 *     picked via the composer's TicketPicker, and that video is
 *     automatically pulled into the post (HuddleComposer.tsx's `ticketVideos`
 *     state) without any extra upload step. Only HuddleComposer does this, and
 *     the Huddle page shows it just for a team's first post — so this one runs
 *     on a freshly created, empty team.
 *
 * The cross-post asserts against the real backend: the post must show the
 * Pulse video card with its poster, and playing it must load the actual
 * /pulsevault/artifacts/:id URL, not just "some video exists".
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  deleteClockEvent,
  findLibraryVideo,
  findOpenClockEventId,
  findPostWithVideo,
  findTeamIdByName,
  removeFromTeam,
} from '../fixtures/db';
import {
  expectImageLoaded,
  getSessionToken,
  posterLocation,
  pulseStatus,
  reservePulseUpload,
  sendPulseVideo,
  uploadPosterAsPulse,
  uploadVideoAsPulse,
  waitForPulseOutcome,
} from '../fixtures/pulse';
import { createTicket, deleteTicket, uploadVideoToTicket } from '../tickets/helpers';
import {
  attachTicket,
  clockOut,
  composerEditor,
  openComposer,
  openPostInInbox,
  setSharedTeamPlanGate,
} from './helpers';

/** Create a team through the UI; the app switches to it. */
async function createFreshTeam(page: Page, name: string): Promise<void> {
  await page.goto('/app/teams');
  await page.getByRole('button', { name: 'Create Team' }).click();
  await page.getByPlaceholder('Team name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });
}

test.describe('Huddle — videos come from Pulse only', () => {
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

  test('the plan composer offers Pulse beside Post, and no raw video upload', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: 'Record your plan with Pulse and clock in' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Video', exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="file"][accept*="video"]')).toHaveCount(0);
  });
});

// One link, one upload, one destination: the server delivers a Pulse upload
// where it was reserved for the moment it lands — nothing to attach or post.
test.describe('Huddle — a Pulse upload goes straight to its destination', () => {
  test.setTimeout(120000);

  test('a Pulse upload for Huddle posts itself to the team feed', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
    await expect(page.getByRole('button', { name: 'Post a video with Pulse' })).toBeVisible();

    const token = await getSessionToken(page);
    const { videoid, status } = await sendPulseVideo(page.request, token, {
      kind: 'huddle',
      teamId,
    });
    expect(status).toEqual({ state: 'done' });

    await page.reload();
    const card = page.getByRole('button', { name: `Play Video ${videoid.slice(0, 8)}` });
    await expect(card).toBeVisible({ timeout: 20000 });
    await expectImageLoaded(card.locator('img'));
  });

  test('a poster frame that lands after its video still reaches the card', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reservePulseUpload(page.request, token, {
      kind: 'huddle',
      teamId,
    });
    // Pulse normally sends the poster first; this covers one that's late.
    await uploadVideoAsPulse(page.request, videoid, uploadToken);
    await waitForPulseOutcome(page.request, token, videoid);
    expect(await posterLocation(page.request, videoid)).toBeNull();
    const posterId = await uploadPosterAsPulse(page.request, videoid, uploadToken);
    expect(await posterLocation(page.request, videoid)).toContain(posterId);

    await page.goto('/app/huddle');
    const card = page.getByRole('button', { name: `Play Video ${videoid.slice(0, 8)}` });
    await expect(card).toBeVisible({ timeout: 20000 });
    await expectImageLoaded(card.locator('img'));
  });

  test('removing a video from the media library leaves it playing where it was posted', async ({
    page,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    const token = await getSessionToken(page);
    const { videoid } = await sendPulseVideo(page.request, token, { kind: 'huddle', teamId });

    const item = await findLibraryVideo(videoid);
    const removed = await page.request.post('/api/media_remove', {
      headers: { Authorization: `Bearer ${token}` },
      data: { mediaId: String(item!._id) },
    });
    expect(removed.status()).toBe(200);

    expect(await findLibraryVideo(videoid)).toBeNull();
    expect(await findPostWithVideo(videoid)).not.toBeNull();
    expect((await page.request.get(`/pulsevault/artifacts/${videoid}`)).status()).toBe(200);
  });

  test.describe('plan and wrap-up', () => {
    test.beforeAll(() => setSharedTeamPlanGate(true));
    test.afterAll(() => setSharedTeamPlanGate(false));

    test('a Pulse plan clocks you in, and a Pulse wrap-up clocks you out', async ({ page }) => {
      await loginAs(page, TEST_USERS.owner1);
      const teamId = await selectSharedTestTeam(page);
      const token = await getSessionToken(page);
      const today = new Date().toLocaleDateString('en-CA');

      const plan = await reservePulseUpload(page.request, token, {
        kind: 'clock-plan',
        teamId,
        postDate: today,
      });
      await uploadVideoAsPulse(page.request, plan.videoid, plan.uploadToken);
      await expect
        .poll(() => findOpenClockEventId(TEST_USERS.owner1.email, teamId), { timeout: 20000 })
        .not.toBeNull();

      const clockEventId = (await findOpenClockEventId(TEST_USERS.owner1.email, teamId))!;
      const wrapUp = await reservePulseUpload(page.request, token, {
        kind: 'clock-wrapup',
        clockEventId,
        postDate: today,
      });
      await uploadVideoAsPulse(page.request, wrapUp.videoid, wrapUp.uploadToken);
      await expect
        .poll(() => findOpenClockEventId(TEST_USERS.owner1.email, teamId), { timeout: 20000 })
        .toBeNull();
    });

    test('the Clock page says the Pulse plan and wrap-up landed, through clocking in and out', async ({
      page,
    }) => {
      await loginAs(page, TEST_USERS.owner1);
      const teamId = await selectSharedTestTeam(page);
      await page.goto('/app/clock');

      // Press Pulse as a person would, then send the video Pulse would.
      const recordWithPulse = async (name: string) => {
        const reserved = page.waitForResponse((res) =>
          res.url().includes('/api/pulsevault_reserve'),
        );
        await page.getByRole('button', { name }).click();
        const { result } = await (await reserved).json();
        const dialog = page.getByRole('dialog', { name: 'Record with Pulse' });
        await expect(dialog).toBeVisible();
        await uploadVideoAsPulse(page.request, result.videoid, result.uploadToken);
        return dialog;
      };

      // Each step changes the page under the popup (clocking in swaps the
      // composer; clocking out ends the session the wrap-up was for), and the
      // popup still has to say it worked.
      const plan = await recordWithPulse('Record your plan with Pulse and clock in');
      await expect(plan.getByText("Plan posted — you're clocked in")).toBeVisible({
        timeout: 20000,
      });
      await expect(plan).toBeHidden({ timeout: 5000 });

      const wrapUp = await recordWithPulse('Record your wrap-up with Pulse and clock out');
      await expect(wrapUp.getByText("Wrap-up posted — you're clocked out")).toBeVisible({
        timeout: 20000,
      });
      expect(await findOpenClockEventId(TEST_USERS.owner1.email, teamId)).toBeNull();
    });

    test('a Pulse plan recorded while already clocked in becomes that session’s plan', async ({
      page,
    }) => {
      await loginAs(page, TEST_USERS.owner1);
      const teamName = `Test Team Second Plan ${Date.now()}`;
      await createFreshTeam(page, teamName);
      const teamId = await findTeamIdByName(teamName);
      const token = await getSessionToken(page);
      const today = new Date().toLocaleDateString('en-CA');
      const plan = { kind: 'clock-plan', teamId, postDate: today };

      await sendPulseVideo(page.request, token, plan);
      const clockEventId = await findOpenClockEventId(TEST_USERS.owner1.email, teamId);
      expect(clockEventId).not.toBeNull();

      // Clocked in already: no second session, and this plan joins the open one.
      const second = await sendPulseVideo(page.request, token, plan);
      expect(second.status).toEqual({ state: 'done' });
      expect(await findOpenClockEventId(TEST_USERS.owner1.email, teamId)).toBe(clockEventId);
      expect((await findPostWithVideo(second.videoid))?.clockEventId).toBe(clockEventId);

      await deleteClockEvent(clockEventId!);
    });

    test("a video that can't reach its destination is kept in the library, and status says why", async ({
      page,
    }) => {
      test.setTimeout(90000);
      await loginAs(page, TEST_USERS.owner1);
      // A team of its own ("Test Team" prefix: global teardown removes it), so
      // deleting this session can't disturb the shared team's clock state.
      const teamName = `Test Team Kept ${Date.now()}`;
      await createFreshTeam(page, teamName);
      const teamId = await findTeamIdByName(teamName);
      const token = await getSessionToken(page);
      const today = new Date().toLocaleDateString('en-CA');

      const plan = await reservePulseUpload(page.request, token, {
        kind: 'clock-plan',
        teamId,
        postDate: today,
      });
      await uploadVideoAsPulse(page.request, plan.videoid, plan.uploadToken);
      await expect
        .poll(() => findOpenClockEventId(TEST_USERS.owner1.email, teamId), { timeout: 20000 })
        .not.toBeNull();
      const clockEventId = (await findOpenClockEventId(TEST_USERS.owner1.email, teamId))!;

      // The wrap-up is reserved while the session exists, then the session is
      // deleted before the video lands.
      const wrapUp = await reservePulseUpload(page.request, token, {
        kind: 'clock-wrapup',
        clockEventId,
        postDate: today,
      });
      await deleteClockEvent(clockEventId);
      await uploadVideoAsPulse(page.request, wrapUp.videoid, wrapUp.uploadToken);

      await expect
        .poll(() => pulseStatus(page.request, token, wrapUp.videoid), { timeout: 20000 })
        .toEqual({ state: 'kept', reason: 'That clock session no longer exists.' });
      const kept = await findLibraryVideo(wrapUp.videoid);
      expect(kept?.recordedFor).toMatchObject({ kind: 'clock-wrapup', clockEventId });
    });

    test('delivery rechecks the destination: leaving the team, or a deleted session, keeps the video', async ({
      page,
    }) => {
      test.setTimeout(90000);
      await loginAs(page, TEST_USERS.owner1);
      const teamName = `Test Team Recheck ${Date.now()}`;
      await createFreshTeam(page, teamName);
      const teamId = await findTeamIdByName(teamName);
      const token = await getSessionToken(page);
      const today = new Date().toLocaleDateString('en-CA');

      const plan = await reservePulseUpload(page.request, token, {
        kind: 'clock-plan',
        teamId,
        postDate: today,
      });
      await uploadVideoAsPulse(page.request, plan.videoid, plan.uploadToken);
      await expect
        .poll(() => findOpenClockEventId(TEST_USERS.owner1.email, teamId), { timeout: 20000 })
        .not.toBeNull();
      const clockEventId = (await findOpenClockEventId(TEST_USERS.owner1.email, teamId))!;

      // Both reserved while everything is valid…
      const wrapUp = await reservePulseUpload(page.request, token, {
        kind: 'clock-wrapup',
        clockEventId,
        postDate: today,
      });
      const sessionVideo = await reservePulseUpload(page.request, token, {
        kind: 'clock',
        id: clockEventId,
      });

      // …then the uploader leaves the team before the wrap-up lands,
      await removeFromTeam(teamId, TEST_USERS.owner1.email);
      await uploadVideoAsPulse(page.request, wrapUp.videoid, wrapUp.uploadToken);
      await expect
        .poll(() => pulseStatus(page.request, token, wrapUp.videoid), { timeout: 20000 })
        .toEqual({ state: 'kept', reason: 'Not a member of this team' });

      // …and the session is deleted before the session video lands.
      await deleteClockEvent(clockEventId);
      await uploadVideoAsPulse(page.request, sessionVideo.videoid, sessionVideo.uploadToken);
      await expect
        .poll(() => pulseStatus(page.request, token, sessionVideo.videoid), { timeout: 20000 })
        .toEqual({ state: 'kept', reason: 'That clock session no longer exists.' });
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
    await page.getByRole('button', { name: 'Share an update...' }).click();
    await composerEditor(page).waitFor({ state: 'visible', timeout: 20000 });

    const postText = `Huddle Cross-post Test ${Date.now()}`;
    await composerEditor(page).fill(postText);

    await attachTicket(page, TICKET_TITLE);

    // The video is pulled in automatically the moment the ticket is picked —
    // this is the behavior under test, and it must be visible before posting.
    await expect(page.getByText('(from ticket)')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Post', exact: true }).click();

    const post = await openPostInInbox(page, postText);
    const play = post.getByRole('button', { name: /^Play / });
    await expect(play).toBeVisible({ timeout: 10000 });
    // The ticket video's poster comes with it: it belongs to the video.
    await expectImageLoaded(play.locator('img'));

    // Playing swaps the poster for an inline player on the real artifact URL.
    await play.click();
    await expect(post.locator('video[src*="/pulsevault/artifacts/"]')).toBeVisible();
  });
});
