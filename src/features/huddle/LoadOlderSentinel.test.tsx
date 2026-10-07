import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadOlderSentinel } from './LoadOlderSentinel';

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let observers: Array<{ callback: ObserverCallback; disconnected: boolean }> = [];

beforeEach(() => {
  observers = [];
  class FakeObserver {
    private record: { callback: ObserverCallback; disconnected: boolean };
    constructor(callback: ObserverCallback) {
      this.record = { callback, disconnected: false };
      observers.push(this.record);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.record.disconnected = true;
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const live = () => observers.filter((o) => !o.disconnected);
/** What a screen reader is told: the text of the polite live region. */
const announcement = (container: HTMLElement) =>
  container.querySelector('[aria-live="polite"]')?.textContent ?? '';
const props = {
  hasMore: true,
  loading: false,
  failed: false,
  onVisible: vi.fn(),
  onRetry: vi.fn(),
};

describe('LoadOlderSentinel', () => {
  it('asks for older posts when it scrolls into view', () => {
    const onVisible = vi.fn();
    render(<LoadOlderSentinel {...props} onVisible={onVisible} />);
    live()[0].callback([{ isIntersecting: false }]);
    expect(onVisible).not.toHaveBeenCalled();
    live()[0].callback([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it('observes again after a load finishes, so a short page triggers the next one', () => {
    const { rerender } = render(<LoadOlderSentinel {...props} loading />);
    expect(live()).toHaveLength(0);
    rerender(<LoadOlderSentinel {...props} loading={false} />);
    expect(live()).toHaveLength(1);
  });

  it('does not chain loads while the footer stays on screen, and offers a button instead', () => {
    const onVisible = vi.fn();
    const { rerender } = render(<LoadOlderSentinel {...props} onVisible={onVisible} />);
    live()[0].callback([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(1);

    rerender(<LoadOlderSentinel {...props} onVisible={onVisible} loading />);
    rerender(<LoadOlderSentinel {...props} onVisible={onVisible} loading={false} />);
    act(() => live()[0].callback([{ isIntersecting: true }]));
    expect(onVisible).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Load older posts' }));
    expect(onVisible).toHaveBeenCalledTimes(2);
  });

  it('loads again once the footer has scrolled out of view and back', () => {
    const onVisible = vi.fn();
    const { rerender } = render(<LoadOlderSentinel {...props} onVisible={onVisible} />);
    live()[0].callback([{ isIntersecting: true }]);
    rerender(<LoadOlderSentinel {...props} onVisible={onVisible} loading />);
    rerender(<LoadOlderSentinel {...props} onVisible={onVisible} loading={false} />);
    live()[0].callback([{ isIntersecting: false }]);
    live()[0].callback([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(2);
  });

  it('shows progress while loading, politely announced', () => {
    const { container } = render(<LoadOlderSentinel {...props} loading />);
    expect(announcement(container)).toContain('Loading older posts');
  });

  it('stays quiet until it is known whether older posts exist', () => {
    const { container } = render(<LoadOlderSentinel {...props} hasMore={null} />);
    expect(announcement(container)).toBe('');
    expect(live()).toHaveLength(0);
  });

  it('marks the end of history and stops observing', () => {
    const { container } = render(<LoadOlderSentinel {...props} hasMore={false} />);
    expect(announcement(container)).toContain('No older posts');
    expect(live()).toHaveLength(0);
  });

  it('waits for an explicit retry after a failure', () => {
    const onRetry = vi.fn();
    render(<LoadOlderSentinel {...props} failed onRetry={onRetry} />);
    expect(live()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('stops observing when unmounted', () => {
    const { unmount } = render(<LoadOlderSentinel {...props} />);
    unmount();
    expect(live()).toHaveLength(0);
  });
});
