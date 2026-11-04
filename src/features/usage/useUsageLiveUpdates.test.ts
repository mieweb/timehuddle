import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDdpClient } from '../../lib/ddp';
import {
  LIVE_REFETCH_DELAY_MS,
  LIVE_REFETCH_MIN_INTERVAL_MS,
  useUsageLiveUpdates,
} from './useUsageLiveUpdates';

vi.mock('../../lib/ddp', () => ({ getDdpClient: vi.fn() }));

/** A fake DDP client: `signal()` fires the usageLive listener, `ready()` the sub's onReady. */
function setupDdp() {
  let listener: () => void = () => {};
  let onReady: () => void = () => {};
  const unsubscribe = vi.fn();
  const offChange = vi.fn();
  const subscribe = vi.fn((_name: string, _params: unknown[], ready?: () => void) => {
    onReady = ready ?? (() => {});
    return unsubscribe;
  });
  vi.mocked(getDdpClient).mockReturnValue({
    onCollectionChange: (_collection: string, fn: () => void) => {
      listener = fn;
      return offChange;
    },
    subscribe,
  } as unknown as ReturnType<typeof getDdpClient>);
  return {
    subscribe,
    unsubscribe,
    offChange,
    signal: () => listener(),
    ready: () => onReady(),
  };
}

describe('useUsageLiveUpdates', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('subscribes to usage.live for the org, or every org when none is given', () => {
    const ddp = setupDdp();
    const { rerender } = renderHook(({ orgId }) => useUsageLiveUpdates(orgId, true, vi.fn()), {
      initialProps: { orgId: 'org-1' as string | undefined },
    });
    expect(ddp.subscribe).toHaveBeenLastCalledWith(
      'usage.live',
      [{ orgId: 'org-1' }],
      expect.any(Function),
    );

    rerender({ orgId: undefined });
    expect(ddp.unsubscribe).toHaveBeenCalledTimes(1);
    expect(ddp.subscribe).toHaveBeenLastCalledWith('usage.live', [{}], expect.any(Function));
  });

  it('does not subscribe when the viewer cannot see the report', () => {
    const ddp = setupDdp();
    renderHook(() => useUsageLiveUpdates(undefined, false, vi.fn()));
    expect(ddp.subscribe).not.toHaveBeenCalled();
  });

  it('refetches once when the subscription is ready, to cover changes since the first fetch', () => {
    const ddp = setupDdp();
    const onChange = vi.fn();
    renderHook(() => useUsageLiveUpdates(undefined, true, onChange));

    // The signal document's first arrival, before ready, adds nothing extra.
    ddp.signal();
    vi.advanceTimersByTime(LIVE_REFETCH_MIN_INTERVAL_MS);
    expect(onChange).not.toHaveBeenCalled();

    ddp.ready();
    vi.advanceTimersByTime(LIVE_REFETCH_DELAY_MS);
    expect(onChange).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(LIVE_REFETCH_MIN_INTERVAL_MS * 2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('refetches once for a burst of changes, after the settle delay', () => {
    const ddp = setupDdp();
    const onChange = vi.fn();
    renderHook(() => useUsageLiveUpdates(undefined, true, onChange));
    ddp.ready();

    ddp.signal();
    ddp.signal();
    ddp.signal();
    vi.advanceTimersByTime(LIVE_REFETCH_DELAY_MS - 1);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('spaces refetches at least the minimum interval apart', async () => {
    const ddp = setupDdp();
    const onChange = vi.fn();
    renderHook(() => useUsageLiveUpdates(undefined, true, onChange));
    ddp.ready();

    ddp.signal();
    await vi.advanceTimersByTimeAsync(LIVE_REFETCH_DELAY_MS);
    expect(onChange).toHaveBeenCalledTimes(1);

    // A change right after a refetch waits out the rest of the interval.
    ddp.signal();
    await vi.advanceTimersByTimeAsync(LIVE_REFETCH_MIN_INTERVAL_MS - 1);
    expect(onChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('never overlaps refetches: changes during a slow one queue a single follow-up', async () => {
    const ddp = setupDdp();
    let finish: () => void = () => {};
    const onChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => useUsageLiveUpdates(undefined, true, onChange));
    ddp.ready();
    vi.advanceTimersByTime(LIVE_REFETCH_DELAY_MS);
    expect(onChange).toHaveBeenCalledTimes(1);

    // The report is slower than the interval; changes keep arriving meanwhile.
    for (let i = 0; i < 3; i++) {
      ddp.signal();
      vi.advanceTimersByTime(LIVE_REFETCH_MIN_INTERVAL_MS);
    }
    expect(onChange).toHaveBeenCalledTimes(1);

    // When it lands, exactly one follow-up runs for everything that changed.
    finish();
    await vi.advanceTimersByTimeAsync(LIVE_REFETCH_DELAY_MS);
    expect(onChange).toHaveBeenCalledTimes(2);

    finish();
    await vi.advanceTimersByTimeAsync(LIVE_REFETCH_MIN_INTERVAL_MS * 2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('stops listening and cancels a pending refetch on unmount', () => {
    const ddp = setupDdp();
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useUsageLiveUpdates(undefined, true, onChange));
    ddp.ready();

    ddp.signal();
    unmount();
    vi.advanceTimersByTime(LIVE_REFETCH_MIN_INTERVAL_MS);

    expect(onChange).not.toHaveBeenCalled();
    expect(ddp.offChange).toHaveBeenCalledTimes(1);
    expect(ddp.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
