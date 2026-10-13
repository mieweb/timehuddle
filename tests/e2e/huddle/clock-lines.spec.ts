/**
 * Huddle clock lines (#695) — every clock-in/out line names whose clock it is,
 * says "You" for the viewer, sits above the plan posted just before it, ends a
 * running shift with a "still clocked in" line, shows the shift length to team
 * admins only, and carries the day in Person threads.
 *
 * Two teammates' overlapping shifts are seeded straight into the test DB, each
 * with a plan created 20s before its clock started (the plan-first flow), and a
 * shared token in both plans so one search opens the Day thread holding both.
 */
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import {
  conversationRows,
  deleteClockSession,
  deletePost,
  getUserIdByEmail,
  groupInboxBy,
  inboxMessage,
  insertPost,
  openPostInInbox,
  seedClockSession,
} from './helpers';

const MINUTE = 60 * 1000;
const PLAN_LEAD = 20 * 1000;

/** "08:58" — the same local wall-clock format the thread uses. */
function clockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Mon, Oct 12" — the day label Person threads add. */
function dayLabel(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * `now`, or the last moment of yesterday when going `span` back from now crosses
 * local midnight — so everything seeded within `span` lands on one calendar day.
 */
function sameDayReference(now: number, span: number): number {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return now - span < midnight ? midnight - 1 : now;
}

const messageLog = (page: Page) => page.getByRole('log', { name: 'Messages' });

async function threadText(page: Page): Promise<string> {
  return (await messageLog(page).innerText()).replace(/\s+/g, ' ');
}

test.describe('Huddle clock lines', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90000);

  const token = `clocklines-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const oneToken = `${token} one`;
  const twoToken = `${token} two`;
  const oneName = TEST_USERS.member1.name;
  const twoName = TEST_USERS.member2.name;

  // Member One: a finished 20-minute shift. Member Two: started after it, still live.
  // Both plans must share a day, or the Day thread splits in two just after midnight.
  const now = sameDayReference(Date.now(), 30 * MINUTE + PLAN_LEAD);
  const oneStart = now - 30 * MINUTE;
  const oneEnd = oneStart + 20 * MINUTE;
  const twoStart = now - 25 * MINUTE;

  const sessionIds: string[] = [];
  const postIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    await page.close();

    const oneId = await getUserIdByEmail(TEST_USERS.member1.email);
    const twoId = await getUserIdByEmail(TEST_USERS.member2.email);

    // Recorded as each insert lands, so afterAll cleans up even if a later one fails.
    const oneSession = await seedClockSession({
      userId: oneId,
      teamId,
      startTime: oneStart,
      endTime: oneEnd,
    });
    sessionIds.push(oneSession);
    postIds.push(
      await insertPost({
        teamId,
        userId: oneId,
        text: `${oneToken} plan: fix the export`,
        createdAt: oneStart - PLAN_LEAD,
        clockEventId: oneSession,
      }),
    );
    const twoSession = await seedClockSession({
      userId: twoId,
      teamId,
      startTime: twoStart,
      endTime: null,
    });
    sessionIds.push(twoSession);
    postIds.push(
      await insertPost({
        teamId,
        userId: twoId,
        text: `${twoToken} plan: review PRs`,
        createdAt: twoStart - PLAN_LEAD,
        clockEventId: twoSession,
      }),
    );
  });

  test.afterAll(async () => {
    for (const id of postIds) await deletePost(id);
    for (const id of sessionIds) await deleteClockSession(id);
  });

  test('a Day thread names whose clock each line is, in order, with admin-only shift length', async ({
    page,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
    await groupInboxBy(page, 'Day');
    await openPostInInbox(page, token, inboxMessage(page, oneToken).first());
    await expect(inboxMessage(page, twoToken)).toBeVisible();

    const oneIn = `${oneName} clocked in · ${clockTime(oneStart)}`;
    const oneOut = `${oneName} clocked out · ${clockTime(oneEnd)} · 20m`;
    const twoIn = `${twoName} clocked in · ${clockTime(twoStart)}`;
    const twoLive = `${twoName} is still clocked in · since ${clockTime(twoStart)}`;
    await expect(messageLog(page)).toContainText(twoLive);

    const text = await threadText(page);
    const at = (s: string) => {
      const i = text.indexOf(s);
      expect(i, `"${s}" in the thread`).toBeGreaterThanOrEqual(0);
      return i;
    };
    // Each clock-in sits above the plan that was posted just before it.
    expect(at(oneIn)).toBeLessThan(at(oneToken));
    expect(at(twoIn)).toBeLessThan(at(twoToken));
    // The running shift's line closes the thread.
    expect(at(oneOut)).toBeLessThan(at(twoLive));
    expect(at(twoToken)).toBeLessThan(at(twoLive));
    expect(text).not.toContain('Clocked in at');
  });

  test('Session view ends a running shift with its still-clocked-in line', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
    await groupInboxBy(page, 'Session');

    await openPostInInbox(page, twoToken);
    await expect(conversationRows(page).first()).toContainText('Live');
    const twoIn = `${twoName} clocked in · ${clockTime(twoStart)}`;
    const twoLive = `${twoName} is still clocked in · since ${clockTime(twoStart)}`;
    await expect(messageLog(page)).toContainText(twoLive);
    const text = await threadText(page);
    expect(text.indexOf(twoIn)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(twoIn)).toBeLessThan(text.indexOf(twoToken));
    expect(text.indexOf(twoToken)).toBeLessThan(text.indexOf(twoLive));
    expect(text).not.toContain(`${twoName} clocked out`);
  });

  test('Person view adds the day to each clock line', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
    await groupInboxBy(page, 'Person');

    await openPostInInbox(page, oneToken);
    await expect(messageLog(page)).toContainText(
      `${oneName} clocked in · ${dayLabel(oneStart)} · ${clockTime(oneStart)}`,
    );
    await expect(messageLog(page)).toContainText(
      `${oneName} clocked out · ${dayLabel(oneEnd)} · ${clockTime(oneEnd)}`,
    );
  });

  test('the viewer sees "You" for their own clock, and no shift length as a member', async ({
    page,
  }) => {
    await loginAs(page, TEST_USERS.member1);
    await selectSharedTestTeam(page);
    await page.goto('/app/huddle');
    await groupInboxBy(page, 'Session');

    await openPostInInbox(page, oneToken);
    const text = await threadText(page);
    expect(text).toContain(`You clocked in · ${clockTime(oneStart)}`);
    expect(text).toContain(`You clocked out · ${clockTime(oneEnd)}`);
    expect(text).not.toContain(`${clockTime(oneEnd)} · 20m`);
    expect(text).not.toContain(oneName + ' clocked');
  });
});
