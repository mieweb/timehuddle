import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackgroundRefresh } from './useBackgroundRefresh';

const MIN = 60_000;

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

/** Advance the clock, letting the hook's tick and any refresh promise settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function returnToTab() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
}

function userActs() {
  window.dispatchEvent(new Event('pointerdown'));
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useBackgroundRefresh', () => {
  it('refreshes when you come back to the tab, at most once per gap', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    renderHook(() => useBackgroundRefresh(refresh));

    await returnToTab(); // right after the page loaded: too soon
    expect(refresh).not.toHaveBeenCalled();

    await advance(31_000);
    await returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);

    await returnToTab(); // focus and visibilitychange often arrive together
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('polls every 5 minutes while you are active on the page', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    renderHook(() => useBackgroundRefresh(refresh));

    await advance(4 * MIN);
    userActs();
    expect(refresh).not.toHaveBeenCalled();
    await advance(1.5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stops polling once you have been idle', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    renderHook(() => useBackgroundRefresh(refresh));

    await advance(16 * MIN); // nobody touches the page
    expect(refresh).toHaveBeenCalledTimes(3); // at 5, 10 and 15 minutes
    await advance(60 * MIN); // idle for over 15 minutes: no more polls
    expect(refresh).toHaveBeenCalledTimes(3);

    await returnToTab(); // coming back counts as activity, and refreshes at once
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('never refreshes a hidden tab, or while paused', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    const { rerender } = renderHook(({ paused }) => useBackgroundRefresh(refresh, { paused }), {
      initialProps: { paused: true },
    });

    await advance(6 * MIN);
    await returnToTab();
    expect(refresh).not.toHaveBeenCalled();

    rerender({ paused: false });
    setVisibility('hidden');
    await advance(6 * MIN);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('backs off after a failure', async () => {
    const refresh = vi.fn().mockResolvedValue(false);
    renderHook(() => useBackgroundRefresh(refresh));

    const activeFor = async (ms: number) => {
      for (let t = 0; t < ms; t += MIN) {
        userActs();
        await advance(MIN);
      }
    };

    await activeFor(5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
    await activeFor(5 * MIN); // the next poll now waits 10 minutes
    expect(refresh).toHaveBeenCalledTimes(1);
    await activeFor(6 * MIN);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
