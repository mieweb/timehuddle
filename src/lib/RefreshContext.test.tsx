import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REFRESH_TIMEOUT_MS,
  RefreshProvider,
  useRefresh,
  useRefreshTrigger,
} from './RefreshContext';

type Handler = () => Promise<void> | void;

function renderRefresh(handler: Handler, globalHandlers: Handler[] = []) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RefreshProvider globalRefreshHandlers={globalHandlers}>{children}</RefreshProvider>
  );
  return renderHook(
    () => {
      useRefresh(handler);
      return useRefreshTrigger();
    },
    { wrapper },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('triggerRefresh', () => {
  it('stops waiting on a handler that never settles', async () => {
    const { result } = renderRefresh(() => new Promise<void>(() => {}));

    let done = false;
    void result.current().then(() => {
      done = true;
    });

    await act(() => vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 1));
    expect(done).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(done).toBe(true);
  });

  it('still runs the other handlers when one rejects', async () => {
    const global = vi.fn().mockResolvedValue(undefined);
    const { result } = renderRefresh(() => Promise.reject(new Error('boom')), [global]);

    await expect(result.current()).resolves.toBeUndefined();
    expect(global).toHaveBeenCalledTimes(1);
  });

  it('survives a handler that throws synchronously', async () => {
    const global = vi.fn().mockResolvedValue(undefined);
    const { result } = renderRefresh(() => {
      throw new Error('boom');
    }, [global]);

    await expect(result.current()).resolves.toBeUndefined();
    expect(global).toHaveBeenCalledTimes(1);
  });

  it('resolves as soon as every handler has settled', async () => {
    const { result } = renderRefresh(() => Promise.resolve());

    await expect(result.current()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
