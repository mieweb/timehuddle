import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshMocks = vi.hoisted(() => ({
  triggerRefresh: vi.fn(),
}));

vi.mock('./AppLayout', () => ({
  useSidebar: () => ({ isMobileOpen: false }),
}));

vi.mock('@lib/RefreshContext', () => ({
  useRefreshTrigger: () => refreshMocks.triggerRefresh,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn() },
  ImpactStyle: { Medium: 'MEDIUM' },
}));

vi.mock('@mieweb/ui', () => ({
  Spinner: () => null,
}));

import { PullToRefresh } from './PullToRefresh';

const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');

function dispatchTouch(target: HTMLElement, type: string, clientY: number) {
  const touch = {
    identifier: 0,
    target,
    clientX: 10,
    clientY,
    screenX: 10,
    screenY: clientY,
    pageX: 10,
    pageY: clientY,
  } as unknown as Touch;

  let event: Event;
  if (typeof TouchEvent === 'function') {
    try {
      event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : [touch],
      });
    } catch {
      event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', {
        value: type === 'touchend' ? [] : [touch],
      });
    }
  } else {
    event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
      value: type === 'touchend' ? [] : [touch],
    });
  }

  target.dispatchEvent(event);
}

function renderPullToRefresh() {
  return render(
    <main>
      <PullToRefresh>
        <div data-testid="thread">Chat thread</div>
      </PullToRefresh>
    </main>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: 1,
  });
  refreshMocks.triggerRefresh.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  if (originalMaxTouchPoints) {
    Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints);
  } else {
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
  }
});

describe('PullToRefresh', () => {
  it('does not refresh when a nested scroller reaches the top during the same drag', () => {
    renderPullToRefresh();

    const thread = screen.getByTestId('thread');
    thread.scrollTop = 40;

    dispatchTouch(thread, 'touchstart', 100);
    dispatchTouch(thread, 'touchmove', 180);

    thread.scrollTop = 0;
    dispatchTouch(thread, 'touchmove', 220);
    dispatchTouch(thread, 'touchend', 220);

    expect(refreshMocks.triggerRefresh).not.toHaveBeenCalled();
  });

  it('refreshes when a downward drag starts at the top with no nested scroller blocked', async () => {
    renderPullToRefresh();

    const thread = screen.getByTestId('thread');
    dispatchTouch(thread, 'touchstart', 100);
    dispatchTouch(thread, 'touchmove', 300);
    dispatchTouch(thread, 'touchend', 300);

    await waitFor(() => expect(refreshMocks.triggerRefresh).toHaveBeenCalledTimes(1));
  });
});
