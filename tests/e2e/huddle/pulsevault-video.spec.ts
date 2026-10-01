/**
 * Huddle Feed — Pulse Video Tests
 *
 * Videos reach a huddle post only through Pulse:
 *  1. The composer (driven through the Clock tab's plan composer) offers
 *     Pulse beside Post, and no raw "Video" file picker.
 *  1b. A Pulse upload lands where it was reserved for, with no client step:
 *     a Huddle post, a plan that clocks in, a wrap-up that clocks out — and
 *     one whose destination is gone by then is kept in the library instead.
 *  2. Cross-posting: a ticket that already has a Pulse video attached is
 *     picked via the composer's TicketPicker, and that video is
 *     automatically pulled into the post (HuddleComposer.tsx's `ticketVideos`
 *     state) without any extra upload step. Only HuddleComposer does this, and
 *     the Huddle page shows it just for a team's first post — so this one runs
 *     on a freshly created, empty team.
 *
 * The cross-post asserts against the real backend: the post must link to the
 * actual /pulsevault/artifacts/:id URL, not just "some video exists".
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  createTicket,
  deleteTicket,
  getSessionToken,
  reservePulseUpload,
  uploadVideoAsPulse,
  uploadVideoToTicket,
} from '../tickets/helpers';
import {
  attachTicket,
  clockOut,
  composerEditor,
  deleteClockEvent,
  findLibraryVideo,
  findOpenClockEventId,
  findTeamIdByName,
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
    const { videoid, uploadToken } = await reservePulseUpload(page.request, token, {
      destination: { kind: 'huddle', teamId },
    });
    await uploadVideoAsPulse(page.request, videoid, uploadToken);

    await page.reload();
    await expect(page.locator(`a[href*="/pulsevault/artifacts/${videoid}"]`).first()).toBeVisible({
      timeout: 20000,
    });
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
        destination: { kind: 'clock-plan', teamId, postDate: today },
      });
      await uploadVideoAsPulse(page.request, plan.videoid, plan.uploadToken);
      await expect
        .poll(() => findOpenClockEventId(TEST_USERS.owner1.email, teamId), { timeout: 20000 })
        .not.toBeNull();

      const clockEventId = (await findOpenClockEventId(TEST_USERS.owner1.email, teamId))!;
      const wrapUp = await reservePulseUpload(page.request, token, {
        destination: { kind: 'clock-wrapup', clockEventId, postDate: today },
      });
      await uploadVideoAsPulse(page.request, wrapUp.videoid, wrapUp.uploadToken);
      await expect
        .poll(() => findOpenClockEventId(TEST_USERS.owner1.email, teamId), { timeout: 20000 })
        .toBeNull();
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
        destination: { kind: 'clock-plan', teamId, postDate: today },
      });
      await uploadVideoAsPulse(page.request, plan.videoid, plan.uploadToken);
      await expect
        .poll(() => findOpenClockEventId(TEST_USERS.owner1.email, teamId), { timeout: 20000 })
        .not.toBeNull();
      const clockEventId = (await findOpenClockEventId(TEST_USERS.owner1.email, teamId))!;

      // The wrap-up is reserved while the session exists, then the session is
      // deleted before the video lands.
      const wrapUp = await reservePulseUpload(page.request, token, {
        destination: { kind: 'clock-wrapup', clockEventId, postDate: today },
      });
      await deleteClockEvent(clockEventId);
      await uploadVideoAsPulse(page.request, wrapUp.videoid, wrapUp.uploadToken);

      await expect
        .poll(() => pulseStatus(page, token, wrapUp.videoid), { timeout: 20000 })
        .toEqual({ state: 'kept', reason: 'That clock session no longer exists.' });
      const kept = await findLibraryVideo(wrapUp.videoid);
      expect(kept?.recordedFor).toMatchObject({ kind: 'clock-wrapup', clockEventId });
    });
  });
});

/** Where a Pulse upload stands, as the Pulse popup asks for it. */
async function pulseStatus(page: Page, token: string, videoid: string): Promise<unknown> {
  const res = await page.request.post('/api/pulsevault_status', {
    headers: { Authorization: `Bearer ${token}` },
    data: { videoid },
  });
  return (await res.json()).result;
}

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
    await expect(post.locator('a[href*="/pulsevault/artifacts/"]')).toBeVisible({
      timeout: 10000,
    });
  });
});
