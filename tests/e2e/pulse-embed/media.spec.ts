/**
 * The Media page's Unsent videos (PLAN §5.1 F2, §5.2, §5.3; TH-8): the
 * redirect rule, every §5.2 state chip, grouping and filters, Move to…, the
 * undo toasts, the offline notice and the kept toast's View.
 *
 * Runs against a `VITE_PULSE_FAKE=1` build: the scripted fake Pulse from
 * @mieweb/pulse-embed/testing stands in for the native plugin
 * (src/features/pulse-embed/testAdapter.ts). Its drafts are seeded before the
 * page loads (`__PULSE_FAKE_SCRIPT__.drafts`) and their upload jobs are moved
 * by hand (`__PULSE_FAKE__.transition`). The server's Pulse settings are read
 * through, with "Pulse in the app" set per test.
 *
 * Run (PR3-V2): with the test backend on :3101 and no other Vite on the e2e
 * port (a reused server may not be a fake build),
 *   VITE_PULSE_FAKE=1 npx playwright test -c tests/playwright.config.ts tests/e2e/pulse-embed/media.spec.ts
 */
import { expect, test, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTicket, deleteTicket, goToTickets, ticketRow } from '../tickets/helpers';

test.skip(process.env.VITE_PULSE_FAKE !== '1', 'Needs a VITE_PULSE_FAKE=1 build of the frontend');

// ─── The fake Pulse and the server's settings ─────────────────────────────────

type FakeFlow = { result: 'sent'; name?: string } | { result: 'kept' };

type FakeUploadEvent =
  | { type: 'uploading'; progress?: number }
  | { type: 'delivering' }
  | { type: 'needs_credentials' }
  | { type: 'failed'; code?: string }
  | { type: 'delivered'; outcome: 'done' | 'kept'; reason?: string };

interface SeedDraft {
  id: string;
  draftKey: string;
  name: string;
  context: Record<string, unknown> | null;
  state: 'draft' | 'ready';
  clipCount: number;
  durationMs: number;
  hasCaptions: boolean;
  poster: null;
  createdVia: 'host';
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
}

interface FakeWindow {
  __PULSE_FAKE_SCRIPT__?: { flows?: FakeFlow[]; drafts?: SeedDraft[]; online?: boolean };
  __PULSE_FAKE__?: {
    calls: { method: string; args: Record<string, unknown> }[];
    transition(draftId: string, e: FakeUploadEvent): void;
    setOnline(online: boolean): void;
    drafts(): { id: string; state: string }[];
  };
}

const HEX = (c: string) => c.repeat(24);

/** A ticket place's context, as place.ts builds it. */
const ticketContext = (id: string, label: string) => ({
  key: `ticket:${id.toLowerCase()}`,
  kind: 'ticket',
  id,
  label,
  data: { type: 'ticket.video', target: { kind: 'ticket', id: id.toLowerCase() } },
});

/** A Huddle post place's context. */
const postContext = (teamId: string, label: string) => ({
  key: `huddle:${teamId.toLowerCase()}`,
  kind: 'huddle',
  id: teamId,
  label,
  data: { type: 'huddle.post', target: { kind: 'huddle', teamId: teamId.toLowerCase() } },
});

/** A wrap-up's context: a clock video (clock-bound once `confirmedAt` is set). */
const wrapupContext = (eventId: string) => ({
  key: `clock:${eventId}`,
  kind: 'clock',
  id: eventId,
  label: 'Wrap-up · Platform',
  data: {
    type: 'clock.wrapup',
    target: { kind: 'clock', id: eventId },
    clock: { teamId: HEX('d'), postDate: '2026-11-19' },
  },
});

function seed(
  id: string,
  name: string,
  context: Record<string, unknown> | null,
  extra: Partial<SeedDraft> = {},
): SeedDraft {
  return {
    id,
    draftKey: `inst:${id}`,
    name,
    context,
    state: 'ready',
    clipCount: 1,
    durationMs: 42_000,
    hasCaptions: false,
    poster: null,
    createdVia: 'host',
    createdAt: Date.now() - 5 * 60_000,
    updatedAt: Date.now() - 5 * 60_000,
    ...extra,
  };
}

/** What the fake Pulse holds and does, set before the page loads. */
async function scriptFakePulse(
  page: Page,
  script: { flows?: FakeFlow[]; drafts?: SeedDraft[] },
): Promise<void> {
  await page.addInitScript((s) => {
    (window as unknown as FakeWindow).__PULSE_FAKE_SCRIPT__ = {
      flows: s.flows ?? [{ result: 'kept' }],
      drafts: s.drafts ?? [],
    };
  }, script);
}

/** `pulseUploadTypes.list` as the server says it, with "Pulse in the app" as given for every team. */
async function pulseInApp(page: Page, on: boolean): Promise<void> {
  await page.route('**/api/pulseUploadTypes_list*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      result?: { teams?: Record<string, unknown>; runtimePaused?: boolean };
    };
    const result = body.result ?? {};
    const teams = Object.fromEntries(
      Object.keys(result.teams ?? {}).map((id) => [
        id,
        { pulseInApp: on, pulseClockInOut: false, pulseSharedDevice: false },
      ]),
    );
    await route.fulfill({
      response,
      json: { ...body, result: { ...result, runtimePaused: false, teams } },
    });
  });
}

const fake = (page: Page) => ({
  transition: (draftId: string, e: FakeUploadEvent) =>
    page.evaluate(
      ([id, ev]) => (window as unknown as FakeWindow).__PULSE_FAKE__!.transition(id, ev),
      [draftId, e] as const,
    ),
  setOnline: (online: boolean) =>
    page.evaluate((o) => (window as unknown as FakeWindow).__PULSE_FAKE__!.setOnline(o), online),
  calls: (method: string) =>
    page.evaluate(
      (m) =>
        ((window as unknown as FakeWindow).__PULSE_FAKE__?.calls ?? [])
          .filter((c) => c.method === m)
          .map((c) => c.args),
      method,
    ),
  draftIds: () =>
    page.evaluate(() =>
      ((window as unknown as FakeWindow).__PULSE_FAKE__?.drafts() ?? []).map((d) => d.id),
    ),
});

const section = (page: Page) => page.locator('section.unsent-videos');
const row = (page: Page, name: string) =>
  section(page).locator('li.unsent-video-row').filter({ hasText: name });
const menu = async (page: Page, name: string, item: string) => {
  await page.getByRole('button', { name: `More for ${name}` }).click();
  await page.getByRole('menuitem', { name: new RegExp(item) }).click();
};

// ─── The redirect rule (§7.2, O1) ─────────────────────────────────────────────

test.describe('Media: when the page shows', () => {
  test.setTimeout(60_000);

  test('every team off and nothing unsent: /app/media goes to the Dashboard as on main', async ({
    page,
  }) => {
    await pulseInApp(page, false);
    await scriptFakePulse(page, { drafts: [] });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media?team=x1');
    await expect(page).toHaveURL(/\/app\/dashboard\?team=x1$/, { timeout: 15_000 });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toContainText(
      'Media',
    );
  });

  test('every team off and one unsent draft: the page and its nav entry still show (AD25)', async ({
    page,
  }) => {
    await pulseInApp(page, false);
    await scriptFakePulse(page, {
      drafts: [seed('a', 'Login demo', ticketContext(HEX('a'), 'Fix login'))],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await expect(page.getByRole('heading', { name: 'Unsent videos (1)' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/app\/media$/);
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', {
        name: /^Media/,
      }),
    ).toBeVisible();
  });

  test('nothing on this phone: the empty state says where videos come from', async ({ page }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, { drafts: [] });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await expect(
      page.getByText(/Videos you record in TimeHuddle stay here until they're sent\./),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  });
});

// ─── Every §5.2 state ─────────────────────────────────────────────────────────

test.describe('Media: state chips (§5.2)', () => {
  test.setTimeout(90_000);

  test('a video moves through each state, with its chip and its sheet', async ({ page }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [
        seed('a', 'Login demo', ticketContext(HEX('a'), 'Fix login')),
        seed('b', 'Rough cut', ticketContext(HEX('a'), 'Fix login'), { state: 'draft' }),
      ],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    const r = row(page, 'Login demo');
    await expect(r.getByText('Ready to send')).toBeVisible({ timeout: 15_000 });
    await expect(row(page, 'Rough cut').getByText('Draft')).toBeVisible();

    // Tapping a draft opens Pulse's editor.
    await page.getByRole('button', { name: 'Open Rough cut' }).click();
    await expect.poll(async () => (await fake(page).calls('open')).at(-1)?.entry).toBe('edit');

    // Held offline, a queued send waits for the network.
    await fake(page).setOnline(false);
    await menu(page, 'Login demo', 'Send');
    await expect(page.getByText('Sending…').first()).toBeVisible();
    await expect(r.getByText('Waiting for network')).toBeVisible();
    await page.getByRole('button', { name: 'Open Login demo' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Cancel sending' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Edit video' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();

    const steps: [FakeUploadEvent, string][] = [
      [{ type: 'uploading', progress: 0.37 }, 'Uploading 37%'],
      [{ type: 'delivering' }, 'Processing…'],
      [{ type: 'needs_credentials' }, 'Paused · Tap to resume'],
      [{ type: 'failed', code: 'upload.failed' }, "Didn't send"],
    ];
    for (const [event, chip] of steps) {
      await fake(page).transition('a', event);
      await expect(r.getByText(chip)).toBeVisible();
    }

    // A failure's sheet says why, and offers Retry, Move to…, Edit and Delete.
    await page.getByRole('button', { name: 'Open Login demo' }).click();
    await expect(
      sheet.getByText("Your video didn't send. It's saved on this phone."),
    ).toBeVisible();
    for (const name of ['Retry', 'Move to…', 'Edit video', 'Delete']) {
      await expect(sheet.getByRole('button', { name })).toBeVisible();
    }
    await sheet.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(async () => (await fake(page).calls('upload')).length).toBe(2);

    await fake(page).transition('a', { type: 'delivered', outcome: 'done' });
    await expect(r.getByText('Attached ✓')).toBeVisible();
  });

  test('a kept video needs attention until it is dismissed', async ({ page }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [seed('k', 'Gone ticket video', ticketContext(HEX('b'), 'Old ticket'))],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await fake(page).setOnline(false);
    await menu(page, 'Gone ticket video', 'Send');
    await fake(page).transition('k', {
      type: 'delivered',
      outcome: 'kept',
      reason: 'ticket was deleted',
    });
    const r = row(page, 'Gone ticket video');
    await expect(r.getByText('Saved to your library (ticket was deleted)')).toBeVisible({
      timeout: 15_000,
    });
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('button', { name: 'Media, 1 video needs attention' })).toBeVisible();

    await page.getByRole('button', { name: 'Open Gone ticket video' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Dismiss' }).click();
    await expect(nav.getByRole('button', { name: 'Media', exact: true })).toBeVisible();
  });
});

// ─── Grouping and filters ─────────────────────────────────────────────────────

test.describe('Media: grouping', () => {
  test.setTimeout(60_000);

  test('rows group by place; filters show with more than one group and live in the URL', async ({
    page,
  }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [
        seed('t', 'Ticket take', ticketContext(HEX('a'), 'Fix login')),
        seed('p', 'Post take', postContext(HEX('d'), 'Platform')),
      ],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    const s = section(page);
    await expect(s.getByRole('list', { name: 'Tickets' })).toBeVisible({ timeout: 15_000 });
    await expect(s.getByRole('list', { name: 'Posts' })).toBeVisible();

    await s.getByRole('radio', { name: 'Posts' }).click();
    await expect(page).toHaveURL(/[?&]filter=post/);
    await expect(s.getByRole('list', { name: 'Tickets' })).toHaveCount(0);
    await expect(s.getByRole('list', { name: 'Posts' })).toBeVisible();

    await s.getByRole('radio', { name: 'All' }).click();
    await expect(page).not.toHaveURL(/filter=/);
  });

  test('one group: no filters', async ({ page }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [seed('t', 'Ticket take', ticketContext(HEX('a'), 'Fix login'))],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await expect(section(page).getByRole('list', { name: 'Tickets' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(section(page).getByRole('radiogroup')).toHaveCount(0);
  });
});

// ─── Move to… ─────────────────────────────────────────────────────────────────

test.describe('Media: Move to…', () => {
  test.setTimeout(90_000);
  let ticketTitle: string;

  test.beforeEach(() => {
    ticketTitle = `Pulse move ${Date.now()}`;
  });
  test.afterEach(async ({ page }) => {
    await deleteTicket(page, ticketTitle);
  });

  test('an unsent video moves to a ticket found by search, then sends', async ({ page }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [seed('m', 'Stray take', postContext(HEX('d'), 'Platform'))],
    });
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);
    const ticketId = await ticketRow(page, ticketTitle).first().getAttribute('data-ticket-id');
    expect(ticketId).toMatch(/^[0-9a-f]{24}$/);

    await page.goto('/app/media');
    await menu(page, 'Stray take', 'Move to…');
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('searchbox', { name: 'Search tickets' }).fill(ticketTitle);
    await sheet.getByRole('button', { name: ticketTitle }).click();

    await expect
      .poll(async () => (await fake(page).calls('setDraftContext')).length)
      .toBeGreaterThan(0);
    const [moved] = await fake(page).calls('setDraftContext');
    expect((moved.context as { key: string }).key).toBe(`ticket:${ticketId}`);
    await expect.poll(async () => (await fake(page).calls('upload')).length).toBe(1);
    await expect(page.getByText(`Moved to ${ticketTitle} · Sending`).first()).toBeVisible();
  });

  test('a clock video whose clock action ran is never offered Move to…', async ({ page }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [seed('w', 'Wrap-up take', wrapupContext(HEX('c')), { confirmedAt: Date.now() })],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await page.getByRole('button', { name: 'More for Wrap-up take' }).click();
    await expect(page.getByRole('menuitem', { name: /Send/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Move to…/ })).toHaveCount(0);
  });
});

// ─── Undo (§5.3) ──────────────────────────────────────────────────────────────

test.describe('Media: undo', () => {
  test.setTimeout(60_000);

  test('Delete hides the row with Undo; Undo brings it back; left alone, it is deleted', async ({
    page,
  }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [
        seed('x', 'Keep me', ticketContext(HEX('a'), 'Fix login')),
        seed('y', 'Delete me', ticketContext(HEX('a'), 'Fix login')),
      ],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await expect(row(page, 'Keep me')).toBeVisible({ timeout: 15_000 });

    await menu(page, 'Keep me', 'Delete');
    await expect(row(page, 'Keep me')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect(row(page, 'Keep me')).toBeVisible();

    await menu(page, 'Delete me', 'Delete');
    await expect(row(page, 'Delete me')).toHaveCount(0);
    await expect.poll(() => fake(page).draftIds(), { timeout: 10_000 }).not.toContain('y');
    expect(await fake(page).draftIds()).toContain('x');
  });

  test('Send from the list says Sending… with Undo, which cancels it', async ({ page }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [seed('s', 'Send me', ticketContext(HEX('a'), 'Fix login'))],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await fake(page).setOnline(false);
    await menu(page, 'Send me', 'Send');
    await expect(row(page, 'Send me').getByText('Waiting for network')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect.poll(async () => (await fake(page).calls('cancelUpload')).length).toBe(1);
    await expect(row(page, 'Send me').getByText('Ready to send')).toBeVisible();
  });
});

// ─── Offline, and the kept toast's View ───────────────────────────────────────

test.describe('Media: offline and View', () => {
  test.setTimeout(90_000);

  test('offline, the section says it shows this phone alone', async ({ page, context }) => {
    await pulseInApp(page, true);
    await scriptFakePulse(page, {
      drafts: [seed('o', 'Offline take', ticketContext(HEX('a'), 'Fix login'))],
    });
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/media');
    await expect(row(page, 'Offline take')).toBeVisible({ timeout: 15_000 });
    await context.setOffline(true);
    await expect(page.getByText('Offline: showing videos on this phone')).toBeVisible();
    await expect(row(page, 'Offline take')).toBeVisible();
    await context.setOffline(false);
  });

  test("a kept take's toast offers View, which opens Unsent videos", async ({ page }) => {
    const title = `Pulse view ${Date.now()}`;
    await pulseInApp(page, true);
    await page.addInitScript(() => {
      localStorage.setItem('timehuddle.pulse.prePromptSeen', '1');
    });
    await scriptFakePulse(page, { flows: [{ result: 'kept' }] });
    await loginAs(page, TEST_USERS.owner1);
    try {
      await createTicket(page, title);
      await goToTickets(page);
      const glyph = ticketRow(page, title).first().getByRole('button', {
        name: 'Record with Pulse',
      });
      await expect(glyph).toBeVisible({ timeout: 20_000 });
      await glyph.click();
      await page.getByRole('button', { name: 'View' }).first().click();
      await expect(page).toHaveURL(/\/app\/media/);
      await expect(page.getByRole('heading', { name: 'Unsent videos (1)' })).toBeVisible();
    } finally {
      await deleteTicket(page, title);
    }
  });
});
