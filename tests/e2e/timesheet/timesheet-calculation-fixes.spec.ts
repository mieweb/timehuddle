/**
 * Regression tests for two timesheet calculation bugs fixed together
 * (see PR: "fix: clamp dangling break duration and use local-date day
 * grouping in timesheets"):
 *
 * 1. Break Hours must clamp a dangling (never-closed) break to its own
 *    session's endTime, not the live clock — otherwise a stale break left
 *    open on an already-completed session accrues phantom hours forever.
 *
 * 2. The admin timesheet must bucket sessions into calendar days using the
 *    same local-date rule the personal timesheet uses, instead of UTC — so
 *    a late-evening session doesn't land under the wrong day heading (with
 *    a mismatched clock-out time) when viewed by an admin.
 *
 * Both bugs required seeding clock-event shapes the app's own UI can't
 * produce (a completed session with a dangling break; a session pinned to
 * a specific instant that straddles a UTC/local day boundary), so these
 * tests write directly to MongoDB rather than driving the Clock page.
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { TimesheetPage } from '../pages/TimesheetPage';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle?directConnection=true';

async function connectDb(): Promise<{ client: MongoClient; db: Db }> {
  const client = await MongoClient.connect(MONGO_URL);
  return { client, db: client.db() };
}

async function getUserId(db: Db, email: string): Promise<string> {
  const user = await db.collection('users').findOne({ 'emails.address': email });
  if (!user) throw new Error(`Seed user not found: ${email} — did global-setup run?`);
  return String(user._id);
}

async function getDefaultTeamId(db: Db): Promise<string> {
  const team = await db.collection('teams').findOne({ code: 'TEST01' });
  if (!team) throw new Error('Default seed team TEST01 not found — did global-setup run?');
  return team._id.toHexString();
}

/** "YYYY-MM-DD" for the Custom date-range inputs, in the host's local time. */
function toDateInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Selects the Custom preset, fills the date range, applies it, and waits for
 * the fetch to actually finish — rather than a fixed sleep — so assertions
 * don't race a still-in-flight request under load.
 */
async function applyCustomRange(page: Page, start: string, end: string): Promise<void> {
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByRole('textbox', { name: 'Start' }).fill(start);
  await page.getByRole('textbox', { name: 'End' }).fill(end);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page
    .getByText('Loading timesheet…')
    .waitFor({ state: 'hidden', timeout: 8000 })
    .catch(() => {});
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
}

test.describe('Timesheet calculation fixes', () => {
  test('Break Hours clamps a dangling break to the session end, not the live clock', async ({
    page,
  }) => {
    const { client, db } = await connectDb();
    let clockEventId: string | undefined;

    try {
      const userId = await getUserId(db, TEST_USERS.member4.email);
      const teamId = await getDefaultTeamId(db);

      // A completed session from 6 days ago, 10:00 AM -> 2:00 PM (4h), with a
      // break that started 1h in and was NEVER closed (endTime: null) even
      // though the session itself completed. This is the exact data shape
      // that caused Break Hours to balloon: getSessionBreakSeconds used
      // `now` as the fallback end for any open break, regardless of whether
      // its session had already finished — so a break dangling from 6 days
      // ago would report ~144h instead of the correct, session-bounded 3h.
      const sessionStart = new Date();
      sessionStart.setDate(sessionStart.getDate() - 6);
      sessionStart.setHours(10, 0, 0, 0);
      const startTime = sessionStart.getTime();
      const endTime = startTime + 4 * 60 * 60 * 1000;
      const breakStart = startTime + 1 * 60 * 60 * 1000;

      const inserted = await db.collection('clockevents').insertOne({
        userId,
        teamId,
        startTime,
        endTime,
        accumulatedTime: Math.floor((endTime - startTime) / 1000),
      });
      clockEventId = inserted.insertedId.toHexString();

      await db.collection('clockbreaks').insertOne({
        clockEventId,
        startTime: breakStart,
        endTime: null, // dangling — never closed, even though the session is completed
      });

      await loginAs(page, TEST_USERS.member4);
      const timesheetPage = new TimesheetPage(page);
      await timesheetPage.goto();

      // Custom range tightly bounding just this seeded session, so no other
      // test's "now"-relative clock in/out data can leak into the totals.
      const rangeStart = new Date(sessionStart);
      rangeStart.setDate(rangeStart.getDate() - 1);
      const rangeEnd = new Date(sessionStart);
      rangeEnd.setDate(rangeEnd.getDate() + 1);
      await applyCustomRange(page, toDateInput(rangeStart), toDateInput(rangeEnd));

      // Break ran from +1h to the session's own end at +4h => exactly 3h.
      // The pre-fix code would instead report roughly (now - breakStart),
      // i.e. ~144h for a break dangling from 6 days ago.
      await expect(timesheetPage.breakHours).toContainText('3h');
      await expect(timesheetPage.breakHours).not.toContainText(/\d{2,}h/);
    } finally {
      if (clockEventId) {
        await db.collection('clockbreaks').deleteMany({ clockEventId });
        await db.collection('clockevents').deleteOne({ _id: new ObjectId(clockEventId) });
      }
      await client.close();
    }
  });

  test.describe('with a real-world timezone gap', () => {
    // Fort Wayne / US Eastern — chosen because it's the concrete example
    // from the bug report (an admin in Indiana viewing a session logged
    // near local midnight elsewhere).
    test.use({ timezoneId: 'America/New_York' });

    test('two sessions on the same local day are not split across two admin day-groups', async ({
      page,
      browser,
    }) => {
      const { client, db } = await connectDb();
      const clockEventIds: string[] = [];

      try {
        const memberUserId = await getUserId(db, TEST_USERS.member5.email);
        const teamId = await getDefaultTeamId(db);

        // Two sessions, both entirely within Jan 15, 2026 America/New_York
        // (EST, UTC-5) — one late morning, one just before midnight local:
        //   Session A: 10:00-11:00 AM EST Jan 15  => UTC Jan 15 (no boundary)
        //   Session B: 11:00-11:30 PM EST Jan 15  => UTC Jan 16 (crosses it)
        // A single Eastern calendar day spans UTC 05:00 that day through
        // 04:59 the next day, so late-evening local sessions land in the
        // *next* UTC day while earlier ones don't — the same session set
        // splits into two different UTC dates despite being one local day.
        // The old admin grouping (toISOString) would show these as two
        // separate day-groups; the fix (local-date bucketing) keeps them
        // as one, matching the personal timesheet and the real bug report
        // (a merged/split day depending on direction of the offset).
        const sessions = [
          {
            startTime: Date.UTC(2026, 0, 15, 15, 0, 0), // Jan 15, 2026 10:00 EST
            endTime: Date.UTC(2026, 0, 15, 16, 0, 0), // Jan 15, 2026 11:00 EST
          },
          {
            startTime: Date.UTC(2026, 0, 16, 4, 0, 0), // Jan 15, 2026 23:00 EST
            endTime: Date.UTC(2026, 0, 16, 4, 30, 0), // Jan 15, 2026 23:30 EST
          },
        ];

        for (const s of sessions) {
          const inserted = await db.collection('clockevents').insertOne({
            userId: memberUserId,
            teamId,
            startTime: s.startTime,
            endTime: s.endTime,
            accumulatedTime: Math.floor((s.endTime - s.startTime) / 1000),
          });
          clockEventIds.push(inserted.insertedId.toHexString());
        }

        // ── Member's own timesheet: both sessions -> 1 working day ──
        await loginAs(page, TEST_USERS.member5);
        const timesheetPage = new TimesheetPage(page);
        await timesheetPage.goto();
        await applyCustomRange(page, '2026-01-14', '2026-01-17');

        // Both rows should read "Jan 15, 2026" — never "Jan 16, 2026".
        await expect(page.getByText('Jan 16, 2026')).not.toBeVisible();
        await expect(timesheetPage.workingDays).toContainText('1');

        // ── Admin's view of the same member: same 1-day grouping ──
        // Uses the app's documented deep-link support
        // (?tab=timesheet&teamId=&memberId=) to land straight on the admin
        // timesheet panel with this member pre-selected.
        const adminContext = await browser.newContext({ timezoneId: 'America/New_York' });
        const adminPage = await adminContext.newPage();
        try {
          await loginAs(adminPage, TEST_USERS.admin1);
          await adminPage.goto(
            `/app/teams?tab=timesheet&teamId=${teamId}&memberId=${memberUserId}`,
          );
          // Wait for the admin timesheet panel itself to mount (deep-link
          // sets the active tab + selected member asynchronously, once teams
          // data finishes loading).
          await adminPage
            .getByRole('button', { name: 'Custom', exact: true })
            .waitFor({ state: 'visible', timeout: 15000 });

          await applyCustomRange(adminPage, '2026-01-14', '2026-01-17');

          // Before the fix, these two sessions (UTC dates Jan 15 and Jan 16)
          // would have been split into two separate day-groups ("2 days · 2
          // sessions") instead of being recognized as one Eastern calendar
          // day ("1 day · 2 sessions").
          await expect(
            adminPage.getByRole('heading', { name: '1 day · 2 sessions' }),
          ).toBeVisible();
          await expect(adminPage.getByText('Jan 16, 2026')).not.toBeVisible();
        } finally {
          await adminContext.close();
        }
      } finally {
        if (clockEventIds.length > 0) {
          await db.collection('clockbreaks').deleteMany({ clockEventId: { $in: clockEventIds } });
          await db
            .collection('clockevents')
            .deleteMany({ _id: { $in: clockEventIds.map((id) => new ObjectId(id)) } });
        }
        await client.close();
      }
    });
  });
});
