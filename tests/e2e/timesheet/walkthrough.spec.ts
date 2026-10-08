/**
 * Timesheet — a Pulse walkthrough on a pending change.
 *
 * A change that needs approval is sent first; its walkthrough is added after,
 * with Pulse, and the server puts it on the request the moment it lands.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { selectSharedTestTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { getSessionToken, reservePulseUpload, uploadRealVideoViaApi } from '../tickets/helpers';

type ChangeRequest = { id: string; status: string; videoUrl: string | null };

async function call<T>(
  request: APIRequestContext,
  token: string,
  method: string,
  data: object,
): Promise<T> {
  const res = await request.post(`/api/${method}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(res.status(), `${method} failed: ${await res.text()}`).toBe(200);
  return (await res.json()).result as T;
}

/** A finished session on the shared team, then an edit to it that waits for an admin. */
async function sendChangeForApproval(page: Page, teamId: string): Promise<ChangeRequest> {
  const token = await getSessionToken(page);
  const session = await call<{ id: string; startTime: number }>(
    page.request,
    token,
    'clock_start',
    { teamId },
  );
  await call(page.request, token, 'clock_stop', { teamId });
  const result = await call<{ pending?: boolean; request: ChangeRequest }>(
    page.request,
    token,
    'clock_updateTimes',
    {
      clockEventId: session.id,
      startTime: session.startTime - 60_000,
      endTime: Date.now(),
      description: 'Forgot to clock in when the shift started.',
    },
  );
  expect(result.pending).toBe(true);
  return result.request;
}

/** A ticket timer for today on the shared team, then a duration edit that waits for an admin. */
async function sendTimerChangeForApproval(page: Page, teamId: string): Promise<ChangeRequest> {
  const token = await getSessionToken(page);
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
  await call(page.request, token, 'clock_start', { teamId });
  const ticket = await call<{ id?: string; _id?: string }>(page.request, token, 'tickets_create', {
    teamId,
    title: `Walkthrough timer ${Date.now()}`,
  });
  const { entry, session } = await call<{ entry: { id: string }; session: { id: string } }>(
    page.request,
    token,
    'timers_createEntry',
    {
      ticketId: ticket.id ?? ticket._id,
      date,
      startNow: true,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  );
  await call(page.request, token, 'timers_stopSession', { sessionId: session.id, now: Date.now() });
  await call(page.request, token, 'clock_stop', { teamId });
  const result = await call<{ pending?: boolean; request: ChangeRequest }>(
    page.request,
    token,
    'timers_updateEntry',
    {
      entryId: entry.id,
      durationSeconds: 3600,
      description: 'Worked an hour on this before starting the timer.',
    },
  );
  expect(result.pending).toBe(true);
  return result.request;
}

test.describe('Timesheet — Pulse walkthrough on a pending change', () => {
  test.setTimeout(90000);

  test('a walkthrough recorded after sending lands on the request', async ({ page }) => {
    await loginAs(page, TEST_USERS.member1);
    const teamId = await selectSharedTestTeam(page);
    const token = await getSessionToken(page);
    const change = await sendChangeForApproval(page, teamId);

    try {
      await page.goto('/app/timesheet');
      await expect(page.getByText('Pending approval').first()).toBeVisible({ timeout: 20000 });
      await expect(
        page.getByRole('button', { name: 'Add a walkthrough with Pulse' }).first(),
      ).toBeVisible();

      const { videoid, uploadToken } = await reservePulseUpload(page.request, token, {
        kind: 'timesheet-request',
        id: change.id,
      });
      await uploadRealVideoViaApi(page.request, videoid, uploadToken);

      await expect
        .poll(
          async () => {
            const mine = await call<{ requests: ChangeRequest[] }>(
              page.request,
              token,
              'timesheetApprovals_listMine',
              { teamId },
            );
            return mine.requests.find((r) => r.id === change.id)?.videoUrl ?? null;
          },
          { timeout: 30000 },
        )
        .toContain(videoid);

      await page.reload();
      await expect(page.getByText('Walkthrough added').first()).toBeVisible({ timeout: 20000 });
    } finally {
      await call(page.request, token, 'timesheetApprovals_cancel', { requestId: change.id });
    }
  });

  test('a pending ticket-timer change offers Pulse on the Work page', async ({ page }) => {
    await loginAs(page, TEST_USERS.member1);
    const teamId = await selectSharedTestTeam(page);
    const token = await getSessionToken(page);
    const change = await sendTimerChangeForApproval(page, teamId);

    try {
      await page.goto('/app/work');
      await expect(page.getByText('Pending approval').first()).toBeVisible({ timeout: 20000 });
      await expect(
        page.getByRole('button', { name: 'Add a walkthrough with Pulse' }).first(),
      ).toBeVisible();
    } finally {
      await call(page.request, token, 'timesheetApprovals_cancel', { requestId: change.id });
    }
  });

  test("no link is handed out for someone else's change, or one no longer pending", async ({
    browser,
  }) => {
    const member = await (await browser.newContext()).newPage();
    await loginAs(member, TEST_USERS.member1);
    const teamId = await selectSharedTestTeam(member);
    const memberToken = await getSessionToken(member);
    const change = await sendChangeForApproval(member, teamId);

    const owner = await (await browser.newContext()).newPage();
    await loginAs(owner, TEST_USERS.owner1);
    const refused = await owner.request.post('/api/pulsevault_reserve', {
      headers: { Authorization: `Bearer ${await getSessionToken(owner)}` },
      data: { destination: { kind: 'timesheet-request', id: change.id } },
    });
    expect((await refused.json()).error).toBe('forbidden');

    await call(member.request, memberToken, 'timesheetApprovals_cancel', { requestId: change.id });
    const withdrawn = await member.request.post('/api/pulsevault_reserve', {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { destination: { kind: 'timesheet-request', id: change.id } },
    });
    expect((await withdrawn.json()).error).toBe('not-found');
  });
});
