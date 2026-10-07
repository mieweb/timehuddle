import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFeedWindow, windowSince } from './useFeedWindow';

describe('windowSince', () => {
  it('is local midnight, the given number of days back', () => {
    const now = new Date(2026, 9, 6, 15, 30).getTime();
    expect(windowSince(30, now)).toBe(new Date(2026, 8, 6).toISOString());
  });

  it('is the same instant all day, so the window does not drift between renders', () => {
    const morning = new Date(2026, 9, 6, 0, 5).getTime();
    const night = new Date(2026, 9, 6, 23, 55).getTime();
    expect(windowSince(30, morning)).toBe(windowSince(30, night));
  });
});

describe('useFeedWindow', () => {
  const sinceFor = (days: number) => windowSince(days);

  it('starts at 30 days with nothing known about older posts', () => {
    const { result } = renderHook(() => useFeedWindow('team-1'));
    expect(result.current.since).toBe(sinceFor(30));
    expect(result.current.hasMore).toBeNull();
  });

  it('does not widen until a fetch has reported older posts', () => {
    const { result } = renderHook(() => useFeedWindow('team-1'));
    act(() => result.current.loadOlder());
    expect(result.current.since).toBe(sinceFor(30));
    expect(result.current.loadingOlder).toBe(false);
  });

  it('widens by 30 days at a time, one load at a time', () => {
    const { result } = renderHook(() => useFeedWindow('team-1'));
    act(() => result.current.settle('team-1', { ok: true, hasMore: true }));

    act(() => result.current.loadOlder());
    expect(result.current.since).toBe(sinceFor(60));
    expect(result.current.loadingOlder).toBe(true);

    // Seen again while that load is still running: ignored.
    act(() => result.current.loadOlder());
    expect(result.current.since).toBe(sinceFor(60));

    act(() => result.current.settle('team-1', { ok: true, hasMore: true }));
    expect(result.current.loadingOlder).toBe(false);
    act(() => result.current.loadOlder());
    expect(result.current.since).toBe(sinceFor(90));
  });

  it('stops once nothing is older', () => {
    const { result } = renderHook(() => useFeedWindow('team-1'));
    act(() => result.current.settle('team-1', { ok: true, hasMore: true }));
    act(() => result.current.loadOlder());
    act(() => result.current.settle('team-1', { ok: true, hasMore: false }));
    expect(result.current.hasMore).toBe(false);
    act(() => result.current.loadOlder());
    expect(result.current.since).toBe(sinceFor(60));
  });

  it('keeps the widened window after a failed load and waits for a retry', () => {
    const { result } = renderHook(() => useFeedWindow('team-1'));
    act(() => result.current.settle('team-1', { ok: true, hasMore: true }));
    act(() => result.current.loadOlder());
    act(() => result.current.settle('team-1', { ok: false }));

    expect(result.current.loadFailed).toBe(true);
    expect(result.current.since).toBe(sinceFor(60));
    act(() => result.current.loadOlder());
    expect(result.current.since).toBe(sinceFor(60));

    act(() => result.current.retry());
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadingOlder).toBe(true);
    act(() => result.current.settle('team-1', { ok: true, hasMore: true }));
    expect(result.current.loadingOlder).toBe(false);
  });

  it('reports a failed first load, which is the only way back to history', () => {
    const { result } = renderHook(() => useFeedWindow('team-1'));
    act(() => result.current.settle('team-1', { ok: false }));
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.hasMore).toBeNull();
  });

  it('moves forward with the calendar when kept mounted past midnight', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 6, 23, 50));
      const { result, rerender } = renderHook(() => useFeedWindow('team-1'));
      const before = result.current.since;
      expect(before).toBe(windowSince(30, new Date(2026, 9, 6, 23, 50).getTime()));

      vi.setSystemTime(new Date(2026, 9, 7, 0, 10));
      rerender();
      expect(result.current.since).toBe(windowSince(30, new Date(2026, 9, 7, 0, 10).getTime()));
      expect(result.current.since).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives each feed its own window', () => {
    const { result, rerender } = renderHook(({ feed }) => useFeedWindow(feed), {
      initialProps: { feed: 'team-1' },
    });
    act(() => result.current.settle('team-1', { ok: true, hasMore: true }));
    act(() => result.current.loadOlder());
    expect(result.current.since).toBe(sinceFor(60));

    rerender({ feed: 'team-2' });
    expect(result.current.since).toBe(sinceFor(30));
    expect(result.current.hasMore).toBeNull();

    // A late answer for the feed that was left must not touch this one.
    act(() => result.current.settle('team-1', { ok: true, hasMore: true }));
    expect(result.current.hasMore).toBeNull();

    act(() => result.current.settle('team-2', { ok: true, hasMore: true }));
    expect(result.current.hasMore).toBe(true);
  });
});
