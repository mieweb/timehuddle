/**
 * Unit tests for relevant-issue scoring (server/redmine-relevance.js).
 *
 * The ordering is the product decision MVP2 turns on — what a user sees when
 * they click into the search bar without typing — so these pin the rules rather
 * than the arithmetic: a running timer wins, several weak signals can outrank one
 * strong one, age erodes the dated signals, a closed issue sinks but does not
 * vanish, and the reason a row displays is the strongest one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildRelevantIssues,
  latestByIssue,
  scoreRelevantIssues,
  SIGNAL_SCORES,
} from '../server/redmine-relevance';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

/** A slim issue DTO, as `toIssue` shapes one. */
const issue = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  subject: `Issue ${id}`,
  project: { id: 1, name: 'Core' },
  status: { id: 1, name: 'New', isClosed: false },
  assignedTo: null,
  priority: { id: 4, name: 'Normal' },
  tracker: { id: 1, name: 'Bug' },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  ...over,
});

const byId = (...issues: ReturnType<typeof issue>[]) => new Map(issues.map((i) => [i.id, i]));

const score = (signals: Record<string, unknown>, issues: Map<number, unknown>) =>
  scoreRelevantIssues(signals, issues as never, NOW);

describe('latestByIssue', () => {
  it('keeps only the most recent occurrence of each issue', () => {
    expect(
      latestByIssue([
        { issueId: 1, at: '2026-09-20' },
        { issueId: 1, at: '2026-09-24' },
        { issueId: 1, at: '2026-09-22' },
        { issueId: 2, at: '2026-09-01' },
      ]),
    ).toEqual([
      { issueId: 1, lastAt: '2026-09-24' },
      { issueId: 2, lastAt: '2026-09-01' },
    ]);
  });

  it('prefers a dated occurrence over an undated one', () => {
    expect(latestByIssue([{ issueId: 1, at: null }, { issueId: 1, at: '2026-09-02' }])).toEqual([
      { issueId: 1, lastAt: '2026-09-02' },
    ]);
  });

  it('drops entries without a usable issue id, and non-array input', () => {
    expect(latestByIssue([{ issueId: 0, at: null }, { issueId: -3, at: null }, {} as never])).toEqual([]);
    expect(latestByIssue(null as never)).toEqual([]);
  });
});

describe('scoreRelevantIssues', () => {
  it('puts a running timer above any single other signal', () => {
    const list = score({ running: [2], assigned: [1] }, byId(issue(1), issue(2)));
    expect(list.map((row) => row.id)).toEqual([2, 1]);
    expect(list[0].reasons).toEqual(['running']);
  });

  it('sums the signals an issue matched, so several weak ones can outrank one strong one', () => {
    const list = score(
      { assigned: [1], watching: [2], pinned: [2], activity: [{ issueId: 2, lastAt: daysAgo(0) }] },
      byId(issue(1), issue(2)),
    );
    expect(list[0].id).toBe(2);
    expect(list[0].score).toBe(SIGNAL_SCORES.watching + SIGNAL_SCORES.pinned + SIGNAL_SCORES.activity);
    expect(list[1].score).toBe(SIGNAL_SCORES.assigned);
  });

  it('reports reasons strongest first, which is the chip the dropdown shows', () => {
    const list = score(
      { assigned: [1], watching: [1], logged: [{ issueId: 1, lastAt: daysAgo(1) }] },
      byId(issue(1)),
    );
    expect(list[0].reasons).toEqual(['assigned', 'logged', 'watching']);
  });

  it('erodes a dated signal by two points a day', () => {
    const fresh = score({ logged: [{ issueId: 1, lastAt: daysAgo(0) }] }, byId(issue(1)));
    const old = score({ logged: [{ issueId: 1, lastAt: daysAgo(7) }] }, byId(issue(1)));
    expect(fresh[0].score).toBe(SIGNAL_SCORES.logged);
    expect(old[0].score).toBe(SIGNAL_SCORES.logged - 14);
  });

  it('never lets decay turn a signal into a penalty', () => {
    const ancient = score({ activity: [{ issueId: 1, lastAt: daysAgo(400) }] }, byId(issue(1)));
    expect(ancient[0].score).toBe(0);
  });

  it('treats an undated signal as fully decayed rather than as today', () => {
    const list = score(
      { logged: [{ issueId: 1, lastAt: null }, { issueId: 2, lastAt: daysAgo(0) }] },
      byId(issue(1), issue(2)),
    );
    expect(list.map((row) => row.id)).toEqual([2, 1]);
    expect(list[1].score).toBe(0);
  });

  it('sinks a closed issue below the live ones without dropping it', () => {
    const list = score(
      { assigned: [1, 2] },
      byId(issue(1, { status: { id: 5, name: 'Closed', isClosed: true } }), issue(2)),
    );
    expect(list.map((row) => row.id)).toEqual([2, 1]);
    expect(list[1].score).toBe(SIGNAL_SCORES.assigned - 50);
  });

  it('spares the closed penalty when a timer is running on it', () => {
    const closed = issue(1, { status: { id: 5, name: 'Closed', isClosed: true } });
    const list = score({ running: [1] }, byId(closed));
    expect(list[0].score).toBe(SIGNAL_SCORES.running);
  });

  it('breaks a tie on the issue Redmine touched most recently', () => {
    const list = score(
      { assigned: [1, 2, 3] },
      byId(
        issue(1, { updatedAt: '2026-09-01T00:00:00.000Z' }),
        issue(2, { updatedAt: '2026-09-24T00:00:00.000Z' }),
        issue(3, { updatedAt: '2026-09-10T00:00:00.000Z' }),
      ),
    );
    expect(list.map((row) => row.id)).toEqual([2, 3, 1]);
  });

  it('carries the last time-logged date, and only for the logged signal', () => {
    const list = score(
      { logged: [{ issueId: 1, lastAt: '2026-09-23' }], assigned: [2] },
      byId(issue(1), issue(2)),
    );
    const rowFor = (id: number) => list.find((row) => row.id === id)!;
    expect(rowFor(1).lastTimeLoggedAt).toBe('2026-09-23');
    expect(rowFor(2)).not.toHaveProperty('lastTimeLoggedAt');
  });

  it('pays a signal once even when it names the same issue twice', () => {
    const list = score({ assigned: [1, 1, 1] }, byId(issue(1)));
    expect(list).toHaveLength(1);
    expect(list[0].score).toBe(SIGNAL_SCORES.assigned);
  });

  it('drops an id whose slim fields could not be resolved', () => {
    const list = score({ assigned: [1, 404] }, byId(issue(1)));
    expect(list.map((row) => row.id)).toEqual([1]);
  });

  it('returns the slim issue fields unchanged, and nothing Redmine sent beyond them', () => {
    const [row] = score({ assigned: [1] }, byId(issue(1)));
    expect(Object.keys(row).sort()).toEqual([
      'assignedTo',
      'createdAt',
      'id',
      'priority',
      'project',
      'reasons',
      'score',
      'status',
      'subject',
      'tracker',
      'updatedAt',
    ]);
  });
});

// ─── Gathering the signals ───────────────────────────────────────────────────

/**
 * The half of the relevant list that talks to Redmine, driven by a stubbed
 * `fetch`. The case worth the setup is the one a real enterprise instance will
 * produce sooner or later: one query is slow or broken, and the list has to arrive
 * anyway, marked `partial`, instead of failing outright.
 */
describe('buildRelevantIssues', () => {
  const account = { apiKey: 'key', baseUrl: 'https://redmine.test' };

  /** A raw Redmine issue, as `/issues.json` sends one. */
  const rawIssue = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    subject: `Issue ${id}`,
    project: { id: 1, name: 'Core' },
    status: { id: 1, name: 'New', is_closed: false },
    priority: { id: 4, name: 'Normal' },
    tracker: { id: 1, name: 'Bug' },
    created_on: '2026-09-01T00:00:00Z',
    updated_on: '2026-09-20T00:00:00Z',
    ...over,
  });

  /** A path fragment → responder table. An absent entry means "this signal is down". */
  type Routes = Record<string, (() => Response | Promise<Response>) | undefined>;

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const atom = (body: string) =>
    new Response(body, { status: 200, headers: { 'Content-Type': 'application/atom+xml' } });

  /**
   * Route each stubbed request by path, so a test names only the answers it cares
   * about. An unlisted path throws, which is how "this signal is down" is spelled.
   */
  const stubRedmine = (routes: Routes) => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url);
        const responder = Object.keys(routes)
          .filter((path) => url.includes(path))
          .map((path) => routes[path])
          .find(Boolean);
        if (!responder) throw new TypeError('fetch failed');
        return responder();
      }),
    );
    return seen;
  };

  afterEach(() => vi.unstubAllGlobals());

  const allSignalsUp = (): Routes => ({
    'assigned_to_id=me': () => json({ issues: [rawIssue(1)] }),
    'watcher_id=me': () => json({ issues: [rawIssue(2)] }),
    '/time_entries.json': () =>
      json({ time_entries: [{ issue: { id: 3 }, spent_on: '2026-09-24', comments: 'SECRET' }] }),
    '/activity.atom': () =>
      atom(
        `<feed><entry><title>Bug #4: SECRET</title>` +
          `<link href="https://redmine.test/issues/4"/><updated>2026-09-24T00:00:00Z</updated>` +
          `</entry></feed>`,
      ),
    'issue_id=': () => json({ issues: [rawIssue(3), rawIssue(4)] }),
  });

  it('merges every signal and resolves the ids that arrived bare', async () => {
    stubRedmine(allSignalsUp());
    const built = await buildRelevantIssues(account, { redmineUserId: 7, now: NOW });

    expect(built.partial).toBe(false);
    expect(built.issues.map((row) => row.id).sort()).toEqual([1, 2, 3, 4]);
    expect(built.issues.find((row) => row.id === 1)!.reasons).toEqual(['assigned']);
    expect(built.issues.find((row) => row.id === 3)!.reasons).toEqual(['logged']);
  });

  it('never carries free text from a time-entry comment or an activity entry', async () => {
    stubRedmine(allSignalsUp());
    const built = await buildRelevantIssues(account, { redmineUserId: 7, now: NOW });
    expect(JSON.stringify(built)).not.toContain('SECRET');
  });

  it('serves the rest of the list when one signal fails, marked partial', async () => {
    const routes = allSignalsUp();
    routes['watcher_id=me'] = undefined; // an unrouted path throws
    stubRedmine(routes);

    const built = await buildRelevantIssues(account, { redmineUserId: 7, now: NOW });
    expect(built.partial).toBe(true);
    expect(built.issues.map((row) => row.id)).toContain(1);
    expect(built.issues.map((row) => row.id)).not.toContain(2);
  });

  it('serves the rest of the list when one signal times out', async () => {
    const routes = allSignalsUp();
    routes['/activity.atom'] = () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    stubRedmine(routes);

    const built = await buildRelevantIssues(account, { redmineUserId: 7, now: NOW });
    expect(built.partial).toBe(true);
    expect(built.issues.map((row) => row.id)).toContain(1);
  });

  it('throws the first failure only when every signal failed', async () => {
    stubRedmine({});
    await expect(buildRelevantIssues(account, { redmineUserId: 7, now: NOW })).rejects.toThrow(
      /fetch failed/,
    );
  });

  it('asks nothing about activity when the Redmine user id is unknown', async () => {
    const seen = stubRedmine(allSignalsUp());
    const built = await buildRelevantIssues(account, { redmineUserId: null, now: NOW });

    expect(seen.some((url) => url.includes('/activity.atom'))).toBe(false);
    expect(built.partial).toBe(false);
  });

  it('asks nothing about pins when the caller has none', async () => {
    const seen = stubRedmine(allSignalsUp());
    await buildRelevantIssues(account, { redmineUserId: 7, pinnedIds: [], now: NOW });
    // The only `issue_id=` call is the batched resolve of the bare logged/activity ids.
    expect(seen.filter((url) => url.includes('issue_id=')).length).toBe(1);
  });

  it('leaves out the ids the caller has hidden, and offers the assigned ids to decide', async () => {
    stubRedmine(allSignalsUp());
    const asked: number[][] = [];

    const built = await buildRelevantIssues(account, {
      redmineUserId: 7,
      now: NOW,
      hiddenIssueIds: async (assignedIssueIds) => {
        asked.push(assignedIssueIds);
        return [1, 3];
      },
    });

    expect(asked).toEqual([[1]]);
    expect(built.issues.map((row) => row.id).sort()).toEqual([2, 4]);
  });

  it('never resolves an id the caller has hidden', async () => {
    const seen = stubRedmine(allSignalsUp());
    await buildRelevantIssues(account, {
      redmineUserId: 7,
      now: NOW,
      hiddenIssueIds: async () => [3, 4],
    });
    expect(seen.some((url) => url.includes('issue_id='))).toBe(false);
  });

  it('keeps what the signals returned when the batched resolve fails', async () => {
    const routes = allSignalsUp();
    routes['issue_id='] = undefined;
    stubRedmine(routes);

    const built = await buildRelevantIssues(account, { redmineUserId: 7, now: NOW });
    expect(built.partial).toBe(true);
    expect(built.issues.map((row) => row.id).sort()).toEqual([1, 2]);
  });

  it('bounds every signal at 6 seconds', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    stubRedmine(allSignalsUp());
    await buildRelevantIssues(account, { redmineUserId: 7, now: NOW });

    expect(timeoutSpy.mock.calls.every(([ms]) => ms === 6000)).toBe(true);
    timeoutSpy.mockRestore();
  });
});
