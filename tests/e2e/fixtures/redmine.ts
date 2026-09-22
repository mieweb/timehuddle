/**
 * Network-level stubbing for the Redmine integration.
 *
 * Every Redmine call the app makes goes through `wormholeCall` in
 * `src/lib/api.ts`, which turns `redmine.timeEntries.preview` into a POST to
 * `<api>/api/redmine_timeEntries_preview` and reads `{ result }` back out of
 * the JSON. That single shape is the seam: one `page.route('**\/api/redmine_*')`
 * covers the whole surface, with no API key and nothing written to a real
 * Redmine instance.
 *
 * Why stub rather than talk to redmine0: pushed time entries are create-only
 * (D1), so a live push test would leave permanent rows in a real instance that
 * nobody can delete. The trade-off is explicit — these specs assert "given this
 * payload, the UI does this", and never that the server's ticket-day
 * aggregation, the `alreadySentSeconds` ledger or the `too-short` rule are
 * correct. Those live in the Meteor-side unit tests and must stay there.
 *
 * Usage — install after `loginAs`, before the navigation that mounts the
 * component under test, because `wormholeCall` awaits DDP auth first and real
 * login still has to work:
 *
 *   const rm = await stubRedmine(page, {
 *     status: connectedStatus({ login: 'priya.patel' }),
 *     'timeEntries.preview': preview({ rows: [previewRow({ ticketId: '15' })] }),
 *     'timeEntries.push': () => ({ results: [pushOutcome({ ticketId: '15' })] }),
 *   });
 *   await page.goto('/app/clock');
 *   …
 *   expect(rm.callCount('timeEntries.push')).toBe(1);
 *   expect(rm.calls('timeEntries.push')[0].entries).toEqual([{ ticketId: '15', date: '…' }]);
 *
 * Anything not overridden answers with a valid *disconnected* response, so a
 * method nobody stubbed can never reach a real server, and a spec that forgets
 * one sees "not connected" rather than a hang.
 */
import type { Page, Route } from '@playwright/test';

// ─── Types ───────────────────────────────────────────────────────────────────
//
// Declared here rather than imported from `src/lib/api.ts`: the e2e suite is
// outside the app's tsconfig `include`, and nothing else under tests/ reaches
// into src/. These mirror the app's exported interfaces — if one drifts, the
// spec that depends on it fails, which is the intended signal.

export type RedmineBlockedReason = 'too-short' | 'issue-unavailable' | 'no-activity';

export type RedmineActivityReason =
  'chosen' | 'tracker' | 'is_default' | 'named' | 'first' | 'none';

export interface RedmineStatusShape {
  connected: boolean;
  redmineUserId?: number;
  redmineLogin?: string;
  redmineName?: string;
  baseUrl?: string;
  linkedAt?: string | null;
  defaultActivityId?: number | null;
}

export interface RedmineRowShape {
  ticketId: string;
  date: string;
  seconds: number;
  alreadySentSeconds: number;
  hours: number;
  subject: string | null;
  trackerName: string | null;
  issueMissing: boolean;
  activityId: number | null;
  activityName: string | null;
  activityReason: string;
  blockedReason: RedmineBlockedReason | null;
}

export interface RedminePreviewShape {
  connected: boolean;
  idle: boolean;
  rows: RedmineRowShape[];
  baseUrl: string | null;
}

export interface RedmineOutcomeShape {
  ticketId: string | null;
  date: string | null;
  hours?: number;
  ok: boolean;
  reason?: string;
  entryId?: number;
  storedHours?: number;
}

export interface RedmineNamedShape {
  id: number;
  name: string;
}

export interface RedmineIssueShape {
  id: number;
  subject: string;
  project: RedmineNamedShape | null;
  status: (RedmineNamedShape & { isClosed: boolean }) | null;
  assignedTo: RedmineNamedShape | null;
  priority: RedmineNamedShape | null;
  tracker: RedmineNamedShape | null;
  createdAt: string | null;
  updatedAt: string | null;
  description?: string;
  author?: RedmineNamedShape | null;
  allowedStatuses?: (RedmineNamedShape & { isClosed: boolean })[];
}

/** A recorded request body, as the app POSTed it. */
export type RedmineCall = Record<string, unknown>;

/**
 * What a stubbed method answers with. Either the `result` payload, a function
 * of the request (so call 2 can differ from call 1 — the double-send and
 * already-synced cases need exactly that), or a failure.
 */
export type StubValue =
  | unknown
  | ((params: RedmineCall, callIndex: number) => unknown | Promise<unknown>)
  | RedmineFailure
  | 'abort';

/** A non-2xx reply. `error` is the code `ApiError.code` will carry. */
export interface RedmineFailure {
  /** Meteor error code, e.g. `stale`, `forbidden`. */
  error?: string;
  /** HTTP status; defaults to 400 when an `error` code is given, else 500. */
  status?: number;
  /** Human message; becomes `ApiError.message`. */
  reason?: string;
}

export interface RedmineStub {
  /** Recorded request bodies for one method, oldest first. */
  calls(method: string): RedmineCall[];
  callCount(method: string): number;
  /** Re-stub a method mid-test. */
  set(method: string, value: StubValue): void;
  /** Every method that was called, in order — useful when a spec asserts a flow. */
  methodsCalled(): string[];
}

// ─── Route mapping ───────────────────────────────────────────────────────────

/**
 * `redmine_timeEntries_preview` → `timeEntries.preview`, inverting the
 * dots-to-underscores mapping `wormholeCall` applies, so a recorded request can
 * be attributed back to the method key a spec stubs by.
 */
function methodFor(route: string): string {
  return route.replace(/^redmine_/, '').replace(/_/g, '.');
}

/**
 * Valid "not connected" answers. A spec that forgets to stub something gets a
 * coherent disconnected app rather than a live call or a hang.
 */
const DISCONNECTED: Record<string, unknown> = {
  status: { connected: false },
  connect: { connected: false },
  disconnect: { connected: false },
  'issues.list': { connected: false, baseUrl: null, issues: [] },
  'issues.get': { baseUrl: null, issue: null, journals: [] },
  'issues.create': { baseUrl: null, issue: null, mismatches: [], issueId: 0, confirmed: false },
  'issues.update': { baseUrl: null, issue: null, mismatches: [] },
  'projects.list': { projects: [] },
  'projects.formOptions': {
    trackers: [],
    assignees: [],
    priorities: [],
    defaultPriorityId: null,
    me: null,
  },
  'activities.list': {
    connected: false,
    activities: [],
    selectedId: null,
    selectedReason: 'none',
  },
  'activities.setDefault': {
    connected: false,
    activities: [],
    selectedId: null,
    selectedReason: 'none',
  },
  'timeEntries.preview': { connected: false, idle: true, rows: [], baseUrl: null },
  'timeEntries.push': { results: [] },
};

function isFailure(value: unknown): value is RedmineFailure {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((k) => k === 'error' || k === 'status' || k === 'reason');
}

// ─── The stub ────────────────────────────────────────────────────────────────

/**
 * Intercept every `redmine.*` wormhole call on this page.
 *
 * Matches only `**\/api/redmine_*` — never the auth, DDP or any other app
 * route, so login and the rest of the app keep working against the real test
 * backend.
 */
export async function stubRedmine(
  page: Page,
  overrides: Record<string, StubValue> = {},
): Promise<RedmineStub> {
  const stubs = new Map<string, StubValue>(Object.entries(overrides));
  const recorded = new Map<string, RedmineCall[]>();
  const order: string[] = [];

  async function handle(route: Route): Promise<void> {
    const request = route.request();
    const routeName = new URL(request.url()).pathname.split('/').pop() ?? '';
    const method = methodFor(routeName);

    let params: RedmineCall = {};
    try {
      params = (request.postDataJSON() ?? {}) as RedmineCall;
    } catch {
      params = {};
    }

    const previous = recorded.get(method) ?? [];
    const callIndex = previous.length;
    recorded.set(method, [...previous, params]);
    order.push(method);

    let value = stubs.has(method) ? stubs.get(method) : DISCONNECTED[method];

    // An unmapped redmine_* method means this fixture is out of date with the
    // app. Fail loudly and name it rather than inventing a shape for it.
    if (value === undefined) {
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'unstubbed-method',
          reason: `stubRedmine has no default for "${method}" — add one to DISCONNECTED or stub it in the spec.`,
        }),
      });
      return;
    }

    if (typeof value === 'function') {
      value = await (value as (p: RedmineCall, i: number) => unknown)(params, callIndex);
    }

    if (value === 'abort') {
      await route.abort('failed');
      return;
    }

    if (isFailure(value)) {
      const failure = value;
      await route.fulfill({
        status: failure.status ?? (failure.error ? 400 : 500),
        contentType: 'application/json',
        body: JSON.stringify({
          error: failure.error,
          reason: failure.reason ?? failure.error ?? 'Request failed',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: value }),
    });
  }

  await page.route('**/api/redmine_*', handle);

  return {
    calls: (method) => recorded.get(method) ?? [],
    callCount: (method) => (recorded.get(method) ?? []).length,
    set: (method, value) => {
      stubs.set(method, value);
    },
    methodsCalled: () => [...order],
  };
}

// ─── Builders ────────────────────────────────────────────────────────────────
//
// Each takes only what the spec cares about; everything else is a plausible
// default. A spec should read as the scenario it describes, not as a wall of
// payload.

export const BASE_URL = 'https://redmine.example.test';

export function connectedStatus(
  overrides: Partial<RedmineStatusShape> & { login?: string } = {},
): RedmineStatusShape {
  const { login, ...rest } = overrides;
  return {
    connected: true,
    redmineUserId: 8,
    redmineLogin: login ?? 'test.user',
    redmineName: 'Test User',
    baseUrl: BASE_URL,
    linkedAt: '2026-01-05T09:00:00.000Z',
    defaultActivityId: 9,
    ...rest,
  };
}

/** Today in the app's local `YYYY-MM-DD` form — what a preview row carries. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function previewRow(overrides: Partial<RedmineRowShape> = {}): RedmineRowShape {
  const seconds = overrides.seconds ?? 2232; // 0.62h — a realistic, non-round value
  return {
    ticketId: '15',
    date: today(),
    seconds,
    alreadySentSeconds: 0,
    hours: Math.round((seconds / 3600) * 100) / 100,
    subject: 'Fix the intake form validation',
    trackerName: 'Bug',
    issueMissing: false,
    activityId: 9,
    activityName: 'Development',
    activityReason: 'tracker',
    blockedReason: null,
    ...overrides,
  };
}

export function preview(overrides: Partial<RedminePreviewShape> = {}): RedminePreviewShape {
  return {
    connected: true,
    idle: true,
    rows: [],
    baseUrl: BASE_URL,
    ...overrides,
  };
}

export function pushOutcome(overrides: Partial<RedmineOutcomeShape> = {}): RedmineOutcomeShape {
  const ok = overrides.ok ?? true;
  return {
    ticketId: '15',
    date: today(),
    hours: 0.62,
    ok,
    ...(ok ? { entryId: 4471, storedHours: 0.62 } : {}),
    ...overrides,
  };
}

/** Wraps outcomes in the `{ results }` envelope `timeEntries.push` returns. */
export function pushResult(...outcomes: RedmineOutcomeShape[]): { results: RedmineOutcomeShape[] } {
  return { results: outcomes };
}

export function redmineIssue(overrides: Partial<RedmineIssueShape> = {}): RedmineIssueShape {
  return {
    id: 15,
    subject: 'Fix the intake form validation',
    project: { id: 1, name: 'Intake' },
    status: { id: 2, name: 'In Progress', isClosed: false },
    assignedTo: { id: 8, name: 'Test User' },
    priority: { id: 4, name: 'Normal' },
    tracker: { id: 1, name: 'Bug' },
    createdAt: '2026-01-05T09:00:00.000Z',
    updatedAt: '2026-02-01T11:30:00.000Z',
    ...overrides,
  };
}

/** The detail shape `issues.get` returns: an issue plus description and workflow. */
export function issueDetail(overrides: Partial<RedmineIssueShape> = {}): RedmineIssueShape {
  return {
    ...redmineIssue(),
    description: 'Submitting the intake form with an empty date field throws a 500.',
    author: { id: 3, name: 'Priya Patel' },
    allowedStatuses: [
      { id: 2, name: 'In Progress', isClosed: false },
      { id: 3, name: 'Resolved', isClosed: false },
      { id: 5, name: 'Closed', isClosed: true },
    ],
    ...overrides,
  };
}

export function activityList(
  overrides: Partial<{
    connected: boolean;
    activities: { id: number; name: string; isDefault: boolean }[];
    selectedId: number | null;
    selectedReason: RedmineActivityReason;
  }> = {},
) {
  return {
    connected: true,
    activities: [
      { id: 8, name: 'Design', isDefault: false },
      { id: 9, name: 'Development', isDefault: true },
      { id: 10, name: 'QA', isDefault: false },
    ],
    selectedId: 9,
    selectedReason: 'chosen' as RedmineActivityReason,
    ...overrides,
  };
}

/**
 * Holds a reply open for `ms` before returning `value`.
 *
 * The double-send test needs a deterministic in-flight window; racing real
 * latency is exactly the flake the plan warns against.
 */
export function delayed(ms: number, value: unknown) {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return value;
  };
}
