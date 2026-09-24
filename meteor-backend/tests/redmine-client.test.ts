/**
 * Unit tests for redmine-client (server/redmine-client.js) timeouts.
 *
 * These pin the two rules that keep a slow Redmine from being reported as a
 * broken one:
 *   - our own request timeout is recognised as a timeout, and nothing else is,
 *   - the issue list gets a longer limit than ordinary requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getCurrentUser, isRedmineTimeout, listIssues } from '../server/redmine-client';

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
  const originalBaseUrl = process.env.REDMINE_BASE_URL;
  let timeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.REDMINE_BASE_URL = 'https://redmine.test';
    timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ issues: [], user: { id: 1 } }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    timeoutSpy.mockRestore();
    if (originalBaseUrl === undefined) delete process.env.REDMINE_BASE_URL;
    else process.env.REDMINE_BASE_URL = originalBaseUrl;
  });

  it('gives the issue list 30 seconds', async () => {
    await listIssues('key', { scope: 'all' });
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it('keeps ordinary requests at 8 seconds', async () => {
    await getCurrentUser('key');
    expect(timeoutSpy).toHaveBeenCalledWith(8000);
  });
});
