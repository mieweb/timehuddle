/**
 * Unit tests for redmine-client (server/redmine-client.js) timeouts.
 *
 * These pin the two rules that keep a slow Redmine from being reported as a
 * broken one:
 *   - our own request timeout is recognised as a timeout, and nothing else is,
 *   - an issue list gets a longer limit than ordinary requests, unless the caller
 *     asks for a shorter one (every MVP2 signal does).
 *
 * And the per-user instance rules behind `REDMINE_ALLOW_CUSTOM_URL`:
 *   - a user-supplied URL is accepted only as a plain http(s) URL,
 *   - a stored URL counts only while the flag is on,
 *   - every request goes to the account's own instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getCurrentUser,
  isRedmineBudgetExhausted,
  isRedmineTimeout,
  linkedRedmineBaseUrl,
  listAssignedIssues,
  normalizeRedmineUrl,
} from '../server/redmine-client';
import { withEnv } from './env';

const account = { apiKey: 'key', baseUrl: 'https://redmine.test' };

describe('isRedmineTimeout', () => {
  it('recognises the error AbortSignal.timeout throws', () => {
    expect(isRedmineTimeout(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(true);
  });

  it('does not mistake other failures for a timeout', () => {
    expect(isRedmineTimeout(Object.assign(new Error('Redmine request failed (500)'), { status: 500 }))).toBe(
      false,
    );
    expect(isRedmineTimeout(new TypeError('fetch failed'))).toBe(false);
    expect(isRedmineTimeout(undefined)).toBe(false);
  });
});

describe('request timeouts', () => {
  let timeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ issues: [], user: { id: 1 } }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    timeoutSpy.mockRestore();
  });

  it('gives an issue list 30 seconds by default', async () => {
    await listAssignedIssues(account);
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it('lets a caller ask for a shorter bound, as the MVP2 signals do', async () => {
    await listAssignedIssues(account, { timeoutMs: 6000 });
    expect(timeoutSpy).toHaveBeenCalledWith(6000);
  });

  it('keeps ordinary requests at 8 seconds', async () => {
    await getCurrentUser(account);
    expect(timeoutSpy).toHaveBeenCalledWith(8000);
  });
});

describe('normalizeRedmineUrl', () => {
  it('trims whitespace and trailing slashes, keeping a sub-path', () => {
    expect(normalizeRedmineUrl('  https://redmine.test/  ')).toBe('https://redmine.test');
    expect(normalizeRedmineUrl('http://localhost:3002/redmine//')).toBe('http://localhost:3002/redmine');
  });

  it('rejects anything but a plain http(s) URL', () => {
    for (const raw of [
      '',
      'redmine.test',
      'ftp://redmine.test',
      'file:///etc/passwd',
      'https://user:pass@redmine.test',
      'https://redmine.test/?key=1',
      'https://redmine.test/#top',
      42,
      null,
    ]) {
      expect(normalizeRedmineUrl(raw)).toBeNull();
    }
  });
});

describe('linkedRedmineBaseUrl', () => {
  let restore: () => void;
  afterEach(() => restore());

  it('uses the stored URL while custom URLs are allowed', () => {
    restore = withEnv({ REDMINE_BASE_URL: 'https://default.test', REDMINE_ALLOW_CUSTOM_URL: 'true' });
    expect(linkedRedmineBaseUrl('https://custom.test')).toBe('https://custom.test');
    expect(linkedRedmineBaseUrl(undefined)).toBe('https://default.test');
  });

  it('ignores a stored URL once the flag is off', () => {
    restore = withEnv({ REDMINE_BASE_URL: 'https://default.test', REDMINE_ALLOW_CUSTOM_URL: undefined });
    expect(linkedRedmineBaseUrl('https://custom.test')).toBe('https://default.test');
  });
});

describe('request routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends each request to the account's own instance with its key", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await getCurrentUser({ apiKey: 'other-key', baseUrl: 'https://other.test/sub' });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://other.test/sub/users/current.json');
    expect((init.headers as Record<string, string>)['X-Redmine-API-Key']).toBe('other-key');
  });

  it('refuses to send a request without a base URL', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(getCurrentUser({ apiKey: 'key', baseUrl: null })).rejects.toThrow(/base URL/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

/**
 * Every request is counted against its account's owner inside `redmineRequest`,
 * so a path that reaches Redmine without a per-method limit is still bounded.
 */
describe('the outbound budget', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('refuses a user past 600 requests in a minute, before sending', async () => {
    const owned = { ...account, userId: 'budget-user' };
    for (let call = 0; call < 600; call += 1) await getCurrentUser(owned);

    const refused = await getCurrentUser(owned).catch((err) => err);
    expect(isRedmineBudgetExhausted(refused)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(600);
  });

  it('leaves another user\u2019s budget alone', async () => {
    await expect(getCurrentUser({ ...account, userId: 'other-user' })).resolves.toEqual({ id: 1 });
  });
});
