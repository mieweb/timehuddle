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
  listActivityIssueIds,
  listAssignedIssues,
  redmineAllowedHosts,
  redmineUrlRefusal,
  searchIssues,
} from '../server/redmine-client';

const account = { apiKey: 'personal-key', baseUrl: 'https://redmine.test' };

/** Set (or, for undefined, delete) env vars for one test; returns a restore fn. */
function withEnv(vars: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(vars);
  return () => apply(saved);
}

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

  it('allows anything outside production, so dev can point at localhost over http', () => {
    restore = withEnv({ NODE_ENV: 'development', REDMINE_ALLOWED_HOSTS: undefined });
    expect(redmineUrlRefusal('http://localhost:3002/redmine')).toBeNull();
    expect(redmineUrlRefusal('http://169.254.169.254')).toBeNull();
  });

  it('allows the deployment\'s own Redmine without it being listed', () => {
    restore = withEnv({
      NODE_ENV: 'production',
      REDMINE_BASE_URL: 'https://redmine.test',
      REDMINE_ALLOWED_HOSTS: undefined,
    });
    expect(redmineUrlRefusal('https://redmine.test')).toBeNull();
    expect(redmineAllowedHosts()).toContain('redmine.test');
  });

  it('refuses a host the deployment did not name', () => {
    restore = withEnv({
      NODE_ENV: 'production',
      REDMINE_BASE_URL: 'https://redmine.test',
      REDMINE_ALLOWED_HOSTS: 'other.test',
    });
    expect(redmineUrlRefusal('https://other.test')).toBeNull();
    // The addresses this rule exists for: internal services and cloud metadata.
    expect(redmineUrlRefusal('https://169.254.169.254')).toMatch(/not allowed/);
    expect(redmineUrlRefusal('https://localhost:9200')).toMatch(/not allowed/);
    expect(redmineUrlRefusal('https://redmine.test.evil.example')).toMatch(/not allowed/);
  });

  it('requires https in production, even for an allowed host', () => {
    restore = withEnv({
      NODE_ENV: 'production',
      REDMINE_BASE_URL: 'https://redmine.test',
      REDMINE_ALLOWED_HOSTS: 'other.test',
    });
    expect(redmineUrlRefusal('http://other.test')).toMatch(/https/);
  });

  it('refuses a missing or unusable URL in production', () => {
    restore = withEnv({
      NODE_ENV: 'production',
      REDMINE_BASE_URL: 'https://redmine.test',
      REDMINE_ALLOWED_HOSTS: undefined,
    });
    expect(redmineUrlRefusal(null as never)).toMatch(/configured/);
    expect(redmineUrlRefusal('redmine.test')).toMatch(/usable/);
  });

  it('refuses to send a request to a host it would refuse', async () => {
    restore = withEnv({
      NODE_ENV: 'production',
      REDMINE_BASE_URL: 'https://redmine.test',
      REDMINE_ALLOWED_HOSTS: undefined,
    });
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      getCurrentUser({ apiKey: 'k', baseUrl: 'https://169.254.169.254' }),
    ).rejects.toThrow(/not allowed/);
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
