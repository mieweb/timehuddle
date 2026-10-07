import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RELEASE_CELEBRATED_KEY } from '../../lib/constants';
import { CELEBRATED_VISITS, useReleaseCelebration } from './useReleaseCelebration';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const confetti = vi.mocked((await import('canvas-confetti')).default);

/** The version the hook compares against, derived the same way the hook does. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';

/** The confetti import is dynamic, so the call lands a microtask after render. */
async function settle() {
  await vi.waitFor(() => expect(confetti).toHaveBeenCalled());
}

/** One visit to the page: mount, let the dynamic import land, leave. */
async function visit(hasUnread = false) {
  const { unmount } = renderHook(() => useReleaseCelebration(hasUnread));
  await new Promise((resolve) => setTimeout(resolve, 0));
  unmount();
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
  it('celebrates a version this browser has not seen, and counts the visit', async () => {
    renderHook(() => useReleaseCelebration());

    await settle();
    expect(localStorage.getItem(RELEASE_CELEBRATED_KEY)).toBe(`${APP_VERSION}:1`);
  });

  it(`celebrates the first ${CELEBRATED_VISITS} visits, then stops`, async () => {
    for (let i = 0; i < CELEBRATED_VISITS; i++) await visit();
    const celebrated = confetti.mock.calls.length;
    expect(celebrated).toBeGreaterThan(0);

    await visit();

    expect(confetti).toHaveBeenCalledTimes(celebrated);
    expect(localStorage.getItem(RELEASE_CELEBRATED_KEY)).toBe(
      `${APP_VERSION}:${CELEBRATED_VISITS}`,
    );
  });

  it('starts counting again for a new version', async () => {
    localStorage.setItem(RELEASE_CELEBRATED_KEY, `0.0.1:${CELEBRATED_VISITS}`);

    renderHook(() => useReleaseCelebration());

    await settle();
    expect(localStorage.getItem(RELEASE_CELEBRATED_KEY)).toBe(`${APP_VERSION}:1`);
  });

  it('celebrates unread notes even after the celebrated visits are used up', async () => {
    localStorage.setItem(RELEASE_CELEBRATED_KEY, `${APP_VERSION}:${CELEBRATED_VISITS}`);

    renderHook(() => useReleaseCelebration(true));

    await settle();
  });

  it('celebrates unread notes when storage is unavailable', async () => {
    const denied = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    renderHook(() => useReleaseCelebration(true));

    await settle();
    denied.mockRestore();
  });

  it('skips the confetti under reduced motion, but still counts the visit', () => {
    setReducedMotion(true);

    renderHook(() => useReleaseCelebration());

    expect(confetti).not.toHaveBeenCalled();
    expect(localStorage.getItem(RELEASE_CELEBRATED_KEY)).toBe(`${APP_VERSION}:1`);
  });

  it('gives up rather than celebrating every visit when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => renderHook(() => useReleaseCelebration())).not.toThrow();
    expect(confetti).not.toHaveBeenCalled();
  });
});
