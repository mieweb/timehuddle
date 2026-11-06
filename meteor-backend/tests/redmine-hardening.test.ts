/**
 * Security tests for the Redmine client (server/redmine-client.js) — MVP2 A4.
 *
 * Four rules, each of which is the difference between a leak and no leak:
 *
 *   1. a redirect is never followed, because Node's fetch keeps the
 *      `X-Redmine-API-Key` header across one and would hand the user's personal
 *      key to whatever host it points at;
 *   2. in production the host must be one the deployment named, and the scheme
 *      must be https, because a user-supplied URL is a signed-in user choosing an
 *      address the *server* connects to;
 *   3. the key never appears in a URL, including the Atom feed;
 *   4. a failure is logged without its query string, because a query string can
 *      carry a search term and a user may type a patient's name into the box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCurrentUser,
  isIssueAssignedToMe,
  isNarrowIssueQuery,
  listActivityIssueIds,
  listAssignedIssues,
  redmineUrlRefusal,
  searchIssues,
} from '../server/redmine-client';
import { withEnv } from './env';

const account = { apiKey: 'personal-key', baseUrl: 'https://redmine.test' };

/** A production deployment whose own Redmine is redmine.test. */
const inProduction = () =>
  withEnv({
    NODE_ENV: 'production',
    REDMINE_BASE_URL: 'https://redmine.test',
    SOURCES_ALLOW_PRIVATE_HOSTS: undefined,
  });

describe('redirects are never followed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks fetch not to follow one', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await getCurrentUser(account);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe('manual');
  });

  it('treats a 3xx as a failure rather than a result', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status, headers: { Location: 'https://evil.test/' } })),
      );
      await expect(getCurrentUser(account)).rejects.toMatchObject({ status, redirected: true });
    }
  });
});

describe('redmineUrlRefusal', () => {
  let restore: () => void;
  afterEach(() => restore());

  it('allows anything outside production, so dev can point at localhost over http', async () => {
    restore = withEnv({ NODE_ENV: 'development' });
    expect(await redmineUrlRefusal('http://localhost:3002/redmine')).toBeNull();
    expect(await redmineUrlRefusal('http://169.254.169.254')).toBeNull();
  });

  it("allows the deployment's own Redmine, whatever it resolves to", async () => {
    restore = inProduction();
    expect(await redmineUrlRefusal('https://redmine.test')).toBeNull();
  });

  it('allows any other public server, with no list to add it to', async () => {
    restore = inProduction();
    expect(await redmineUrlRefusal('https://203.0.113.7/redmine')).toBeNull();
  });

  it('refuses a server on a private network', async () => {
    restore = inProduction();
    // The addresses this rule exists for: internal services and cloud metadata.
    expect(await redmineUrlRefusal('https://169.254.169.254')).toMatch(/private network/);
    expect(await redmineUrlRefusal('https://127.0.0.1:9200')).toMatch(/private network/);
  });

  it('requires https in production', async () => {
    restore = inProduction();
    expect(await redmineUrlRefusal('http://203.0.113.7')).toMatch(/https/);
  });

  it('refuses a missing or unusable URL in production', async () => {
    restore = inProduction();
    expect(await redmineUrlRefusal(null as never)).toMatch(/configured/);
    expect(await redmineUrlRefusal('redmine.test')).toMatch(/usable/);
  });

  it('refuses to send a request to a host it would refuse', async () => {
    restore = inProduction();
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      getCurrentUser({ apiKey: 'k', baseUrl: 'https://169.254.169.254' }),
    ).rejects.toThrow(/private network/);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('the API key never travels in a URL', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends it only as a header, including on the Atom activity feed', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response('<feed></feed>', { status: 200 });
      }),
    );

    await listActivityIssueIds(account, { redmineUserId: 7, from: '2026-09-11' });

    expect(urls[0]).toContain('/activity.atom');
    expect(urls[0]).not.toContain('personal-key');
    expect(urls[0]).not.toContain('key=');
  });
});

describe('failure logging', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  /** The single object `redmineRequest` logs for a failure. */
  const logged = () => warn.mock.calls.at(-1)?.[1] as Record<string, unknown>;

  it('records the method, the bare path, the status and the duration', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(listAssignedIssues(account)).rejects.toThrow();

    expect(logged()).toMatchObject({ method: 'GET', path: '/issues.json', status: 500 });
    expect(logged().durationMs).toBeTypeOf('number');
  });

  it('never records the query string, so a search term cannot reach the log', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(searchIssues(account, 'Jane Patient')).rejects.toThrow();

    const line = JSON.stringify(logged());
    expect(line).not.toContain('Jane');
    expect(line).not.toContain('?');
    expect(logged().path).toBe('/search.json');
  });

  it('never records the key, the response body or the headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ errors: ['Jane Patient'] }), { status: 422 })),
    );
    await expect(listAssignedIssues(account)).rejects.toThrow();

    const line = JSON.stringify(logged());
    expect(line).not.toContain('personal-key');
    expect(line).not.toContain('Jane');
    expect(Object.keys(logged()).sort()).toEqual([
      'code',
      'durationMs',
      'method',
      'name',
      'path',
      'status',
    ]);
  });

  it('records a network failure as well as an HTTP one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }),
    );
    await expect(getCurrentUser(account)).rejects.toThrow(/fetch failed/);
    expect(logged()).toMatchObject({ name: 'TypeError', code: 'ECONNREFUSED', status: null });
  });
});

describe('isNarrowIssueQuery', () => {
  it('accepts the filters that pick out a small set', () => {
    for (const filter of ['issue_id', 'assigned_to_id', 'watcher_id', 'author_id']) {
      expect(isNarrowIssueQuery({ [filter]: 'me' })).toBe(true);
    }
  });

  it('refuses a status on its own, since open issues are most of the database', () => {
    expect(isNarrowIssueQuery({ status_id: 'open', limit: '100' })).toBe(false);
  });

  it('refuses a project on its own, since one project can hold thousands of issues', () => {
    expect(isNarrowIssueQuery({ project_id: '12', status_id: 'open' })).toBe(false);
  });

  it('accepts a project alongside a real filter', () => {
    expect(isNarrowIssueQuery({ project_id: '12', assigned_to_id: 'me' })).toBe(true);
  });
});

describe('isIssueAssignedToMe', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubIssues = (issues: unknown[]) => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ issues }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  };

  it('asks the question the "assigned" signal asks, so a group assignment counts', async () => {
    const fetchSpy = stubIssues([{ id: 42 }]);
    await isIssueAssignedToMe(account, 42);

    const [url] = fetchSpy.mock.calls[0] as unknown as [string];
    const query = new URL(url).searchParams;
    expect(query.get('issue_id')).toBe('42');
    expect(query.get('assigned_to_id')).toBe('me');
    expect(query.get('status_id')).toBe('*');
  });

  it('is true when Redmine returns the issue, and false when it does not', async () => {
    // Redmine answers `assigned_to_id=me` with issues assigned to the caller's
    // groups too, whose `assigned_to` is the group rather than the caller.
    stubIssues([{ id: 42, assigned_to: { id: 900, name: 'Support team' } }]);
    await expect(isIssueAssignedToMe(account, 42)).resolves.toBe(true);

    stubIssues([]);
    await expect(isIssueAssignedToMe(account, 42)).resolves.toBe(false);
  });
});
