import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function freshApiModule() {
  vi.resetModules();
  return import('./api');
}

describe('getAccessToken token fetch timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('resolves null when the /api/auth/token fetch never settles, after the shared request timeout', async () => {
    localStorage.setItem('timecore_session_token', 'a-session-token');

    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject((init.signal as AbortSignal).reason ?? new Error('aborted'));
            });
          }),
      ),
    );

    const { getAccessToken } = await freshApiModule();

    const tokenPromise = getAccessToken();
    let settled = false;
    tokenPromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await expect(tokenPromise).resolves.toBeNull();
  });
});
