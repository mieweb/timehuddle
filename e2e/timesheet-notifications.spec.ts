/**
 * Timesheet Notification E2E
 *
 * Verifies that team admins receive push notifications when a team member:
 *  - Adds a manual clock session
 *  - Edits a clock session
 *  - Deletes a clock session
 *  - Adds a work (timesheet) entry
 *  - Edits a work entry
 *  - Deletes a work entry
 *
 * Setup (self-provisioned per test):
 *  Alice Admin  (alice@example.com) — creates team → becomes admin
 *  Bob Builder  (bob@example.com)   — joins team via code → becomes member
 *
 * Bob performs each action; Alice's notification inbox is asserted after.
 * The team is deleted in a finally block so each test is isolated.
 */

import { expect, test, type Page } from '@playwright/test';

const BOB_EMAIL = 'bob@example.com';
const BOB_PASSWORD = 'Password1!';
const ALICE_EMAIL = 'alice@example.com';
const ALICE_PASSWORD = 'Password1!';
const API_BASE = 'http://localhost:4000/v1';
const FRONTEND_BASE = 'http://localhost:3000';

type Notification = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  data?: Record<string, unknown>;
};

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Sign in via the API directly — sets the session cookie in the page's context. */
async function loginAs(page: Page, email: string, password: string) {
  const res = await page.request.post(`http://localhost:4000/api/auth/sign-in/email`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`Login failed for ${email}: ${res.status()} ${await res.text()}`);
  }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function getNotifications(page: Page): Promise<Notification[]> {
  const res = await page.request.get(`${API_BASE}/notifications`);
  const body = (await res.json()) as { notifications: Notification[] };
  return body.notifications ?? [];
}

async function clearNotifications(page: Page): Promise<void> {
  const notifications = await getNotifications(page);
  if (!notifications.length) return;
  await page.request.delete(`${API_BASE}/notifications`, {
    data: { ids: notifications.map((n) => n.id) },
  });
}

// ─── Team lifecycle helpers ────────────────────────────────────────────────────

/**
 * Alice creates a uniquely-named team (she becomes admin).
 * Bob joins via the team code (he becomes member).
 * Returns { teamId, teamName } for use in assertions.
 */
async function setupTestTeam(
  alicePage: Page,
  bobPage: Page,
): Promise<{ teamId: string; teamName: string }> {
  const teamName = `E2E Notifications ${Date.now()}`;
  const createRes = await alicePage.request.post(`${API_BASE}/teams`, {
    data: { name: teamName },
  });
  if (!createRes.ok()) {
    throw new Error(`Team creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { team } = (await createRes.json()) as { team: { id: string; code: string } };

  const joinRes = await bobPage.request.post(`${API_BASE}/teams/join`, {
    data: { teamCode: team.code },
  });
  if (!joinRes.ok()) {
    throw new Error(`Bob failed to join team: ${joinRes.status()} ${await joinRes.text()}`);
  }

  return { teamId: team.id, teamName };
}

/** Alice (admin) deletes the test team — call in a finally block. */
async function teardownTestTeam(alicePage: Page, teamId: string): Promise<void> {
  await alicePage.request.delete(`${API_BASE}/teams/${teamId}`).catch(() => {
    // best-effort cleanup — ignore failures
  });
}

async function createManualClockSession(
  page: Page,
  teamId: string,
): Promise<{ id: string; startTime: number }> {
  const now = Date.now();
  const startTime = now - 3_600_000; // 1 hour ago
  const endTime = now - 1_800_000;   // 30 min ago
  const res = await page.request.post(`${API_BASE}/clock/manual`, {
    data: { teamId, startTime, endTime },
  });
  const { event } = (await res.json()) as { event: { id: string; startTime: number } };
  return { id: event.id, startTime: event.startTime };
}

async function createTicketInDevelopers(page: Page, teamId: string): Promise<string> {
  const res = await page.request.post(`${API_BASE}/tickets`, {
    data: { teamId, title: `E2E notification test ticket ${Date.now()}` },
  });
  const { ticket } = (await res.json()) as { ticket: { id: string } };
  return ticket.id;
}

async function createWorkEntry(page: Page, ticketId: string, date: string): Promise<string> {
  const res = await page.request.post(`${API_BASE}/timers/entries`, {
    data: { ticketId, date, note: 'e2e notification test' },
  });
  const { entry } = (await res.json()) as { entry: { id: string } };
  return entry.id;
}

// ─── Assertion helper ─────────────────────────────────────────────────────────

async function waitForNotification(
  alicePage: Page,
  matcher: (n: Notification) => boolean,
  timeoutMs = 3000,
): Promise<Notification> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const notifications = await getNotifications(alicePage);
    const found = notifications.find(matcher);
    if (found) return found;
    await alicePage.waitForTimeout(300);
  }
  throw new Error('Expected notification not received within timeout');
}

// ─── Clock Session Notification Tests ────────────────────────────────────────

test.describe('Clock Session Notifications', () => {
  test.setTimeout(60000);

  test('admin notified when member adds a manual clock session', async ({ browser }) => {
    const bobCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const aliceCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const bobPage = await bobCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    let teamId: string | null = null;
    try {
      await Promise.all([
        loginAs(bobPage, BOB_EMAIL, BOB_PASSWORD),
        loginAs(alicePage, ALICE_EMAIL, ALICE_PASSWORD),
      ]);
      await clearNotifications(alicePage);

      const { teamId: tid, teamName } = await setupTestTeam(alicePage, bobPage);
      teamId = tid;

      await createManualClockSession(bobPage, teamId);

      const notification = await waitForNotification(
        alicePage,
        (n) =>
          n.title === 'Timesheet Update' &&
          n.body.includes('Bob Builder') &&
          n.body.includes('added') &&
          n.body.includes(teamName),
      );

      expect(notification.title).toBe('Timesheet Update');
      expect(notification.body).toContain('Bob Builder');
      expect(notification.body).toContain('added');
      expect(notification.body).toContain(teamName);
      expect(notification.data?.type).toBe('clock-session-changed');
    } finally {
      if (teamId) await teardownTestTeam(alicePage, teamId);
      await bobCtx.close();
      await aliceCtx.close();
    }
  });

  test('admin notified when member edits a clock session', async ({ browser }) => {
    const bobCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const aliceCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const bobPage = await bobCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    let teamId: string | null = null;
    try {
      await Promise.all([
        loginAs(bobPage, BOB_EMAIL, BOB_PASSWORD),
        loginAs(alicePage, ALICE_EMAIL, ALICE_PASSWORD),
      ]);

      const { teamId: tid, teamName } = await setupTestTeam(alicePage, bobPage);
      teamId = tid;
      const { id: eventId } = await createManualClockSession(bobPage, teamId);

      await clearNotifications(alicePage);

      const now = Date.now();
      await bobPage.request.put(`${API_BASE}/clock/${eventId}/times`, {
        data: {
          startTime: now - 7_200_000, // 2 hours ago
          endTime: now - 3_600_000,   // 1 hour ago
        },
      });

      const notification = await waitForNotification(
        alicePage,
        (n) =>
          n.title === 'Timesheet Update' &&
          n.body.includes('Bob Builder') &&
          n.body.includes('updated') &&
          n.body.includes(teamName),
      );

      expect(notification.body).toContain('Bob Builder');
      expect(notification.body).toContain('updated');
      expect(notification.body).toContain(teamName);
      expect(notification.data?.type).toBe('clock-session-changed');
    } finally {
      if (teamId) await teardownTestTeam(alicePage, teamId);
      await bobCtx.close();
      await aliceCtx.close();
    }
  });

  test('admin notified when member deletes a clock session', async ({ browser }) => {
    const bobCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const aliceCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const bobPage = await bobCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    let teamId: string | null = null;
    try {
      await Promise.all([
        loginAs(bobPage, BOB_EMAIL, BOB_PASSWORD),
        loginAs(alicePage, ALICE_EMAIL, ALICE_PASSWORD),
      ]);

      const { teamId: tid, teamName } = await setupTestTeam(alicePage, bobPage);
      teamId = tid;
      const { id: eventId } = await createManualClockSession(bobPage, teamId);

      await clearNotifications(alicePage);

      await bobPage.request.delete(`${API_BASE}/clock/${eventId}`);

      const notification = await waitForNotification(
        alicePage,
        (n) =>
          n.title === 'Timesheet Update' &&
          n.body.includes('Bob Builder') &&
          n.body.includes('deleted') &&
          n.body.includes(teamName),
      );

      expect(notification.body).toContain('Bob Builder');
      expect(notification.body).toContain('deleted');
      expect(notification.body).toContain(teamName);
      expect(notification.data?.type).toBe('clock-session-changed');
    } finally {
      if (teamId) await teardownTestTeam(alicePage, teamId);
      await bobCtx.close();
      await aliceCtx.close();
    }
  });
});

// ─── Work Entry Notification Tests ───────────────────────────────────────────

test.describe('Work Entry Notifications', () => {
  test.setTimeout(60000);

  test('admin notified when member adds a work entry', async ({ browser }) => {
    const bobCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const aliceCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const bobPage = await bobCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    let teamId: string | null = null;
    try {
      await Promise.all([
        loginAs(bobPage, BOB_EMAIL, BOB_PASSWORD),
        loginAs(alicePage, ALICE_EMAIL, ALICE_PASSWORD),
      ]);
      await clearNotifications(alicePage);

      const { teamId: tid, teamName } = await setupTestTeam(alicePage, bobPage);
      teamId = tid;
      const ticketId = await createTicketInDevelopers(bobPage, teamId);
      const today = new Date().toISOString().slice(0, 10);

      await createWorkEntry(bobPage, ticketId, today);

      const notification = await waitForNotification(
        alicePage,
        (n) =>
          n.title === 'Timesheet Update' &&
          n.body.includes('Bob Builder') &&
          n.body.includes('added') &&
          n.body.includes(teamName),
      );

      expect(notification.title).toBe('Timesheet Update');
      expect(notification.body).toContain('Bob Builder');
      expect(notification.body).toContain('added');
      expect(notification.body).toContain(teamName);
      expect(notification.data?.type).toBe('timesheet-entry-changed');
    } finally {
      if (teamId) await teardownTestTeam(alicePage, teamId);
      await bobCtx.close();
      await aliceCtx.close();
    }
  });

  test('admin notified when member edits a work entry', async ({ browser }) => {
    const bobCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const aliceCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const bobPage = await bobCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    let teamId: string | null = null;
    try {
      await Promise.all([
        loginAs(bobPage, BOB_EMAIL, BOB_PASSWORD),
        loginAs(alicePage, ALICE_EMAIL, ALICE_PASSWORD),
      ]);

      const { teamId: tid, teamName } = await setupTestTeam(alicePage, bobPage);
      teamId = tid;
      const ticketId = await createTicketInDevelopers(bobPage, teamId);
      const today = new Date().toISOString().slice(0, 10);
      const entryId = await createWorkEntry(bobPage, ticketId, today);

      await clearNotifications(alicePage);

      await bobPage.request.patch(`${API_BASE}/timers/entries/${entryId}`, {
        data: { note: 'updated via e2e test' },
      });

      const notification = await waitForNotification(
        alicePage,
        (n) =>
          n.title === 'Timesheet Update' &&
          n.body.includes('Bob Builder') &&
          n.body.includes('updated') &&
          n.body.includes(teamName),
      );

      expect(notification.body).toContain('Bob Builder');
      expect(notification.body).toContain('updated');
      expect(notification.body).toContain(teamName);
      expect(notification.data?.type).toBe('timesheet-entry-changed');
    } finally {
      if (teamId) await teardownTestTeam(alicePage, teamId);
      await bobCtx.close();
      await aliceCtx.close();
    }
  });

  test('admin notified when member deletes a work entry', async ({ browser }) => {
    const bobCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const aliceCtx = await browser.newContext({ baseURL: FRONTEND_BASE });
    const bobPage = await bobCtx.newPage();
    const alicePage = await aliceCtx.newPage();

    let teamId: string | null = null;
    try {
      await Promise.all([
        loginAs(bobPage, BOB_EMAIL, BOB_PASSWORD),
        loginAs(alicePage, ALICE_EMAIL, ALICE_PASSWORD),
      ]);

      const { teamId: tid, teamName } = await setupTestTeam(alicePage, bobPage);
      teamId = tid;
      const ticketId = await createTicketInDevelopers(bobPage, teamId);
      const today = new Date().toISOString().slice(0, 10);
      const entryId = await createWorkEntry(bobPage, ticketId, today);

      await clearNotifications(alicePage);

      await bobPage.request.delete(`${API_BASE}/timers/entries/${entryId}`);

      const notification = await waitForNotification(
        alicePage,
        (n) =>
          n.title === 'Timesheet Update' &&
          n.body.includes('Bob Builder') &&
          n.body.includes('deleted') &&
          n.body.includes(teamName),
      );

      expect(notification.body).toContain('Bob Builder');
      expect(notification.body).toContain('deleted');
      expect(notification.body).toContain(teamName);
      expect(notification.data?.type).toBe('timesheet-entry-changed');
    } finally {
      if (teamId) await teardownTestTeam(alicePage, teamId);
      await bobCtx.close();
      await aliceCtx.close();
    }
  });
});
