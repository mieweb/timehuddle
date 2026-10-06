import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RELEASE_CELEBRATED_KEY } from '../../lib/constants';
import { useReleaseCelebration } from './useReleaseCelebration';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const confetti = vi.mocked((await import('canvas-confetti')).default);

/** The version the hook compares against, derived the same way the hook does. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';

/** The confetti import is dynamic, so the call lands a microtask after render. */
async function settle() {
  await vi.waitFor(() => expect(confetti).toHaveBeenCalled());
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia,
  );
}

beforeEach(() => {
  localStorage.clear();
  confetti.mockClear();
  setReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReleaseCelebration', () => {
  it('celebrates a version this browser has not seen, and records it', async () => {
    renderHook(() => useReleaseCelebration());

    await settle();
    expect(localStorage.getItem(RELEASE_CELEBRATED_KEY)).toBe(APP_VERSION);
  });

  it('stays quiet on a version already celebrated here', () => {
    localStorage.setItem(RELEASE_CELEBRATED_KEY, APP_VERSION);

    renderHook(() => useReleaseCelebration());

    expect(confetti).not.toHaveBeenCalled();
  });

  it('celebrates once, not again on a remount in the same session', async () => {
    const { unmount } = renderHook(() => useReleaseCelebration());
    await settle();
    const firstRun = confetti.mock.calls.length;
    unmount();

    renderHook(() => useReleaseCelebration());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(confetti).toHaveBeenCalledTimes(firstRun);
  });

  it('skips the confetti under reduced motion, but still records the version', () => {
    setReducedMotion(true);

    renderHook(() => useReleaseCelebration());

    expect(confetti).not.toHaveBeenCalled();
    expect(localStorage.getItem(RELEASE_CELEBRATED_KEY)).toBe(APP_VERSION);
  });

  it('gives up rather than celebrating every visit when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => renderHook(() => useReleaseCelebration())).not.toThrow();
    expect(confetti).not.toHaveBeenCalled();
  });
});
