import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RefreshProvider,
  useRefresh,
  useRefreshTrigger,
  type RefreshOutcome,
} from './RefreshContext';

/** Renders the trigger result into the DOM so tests can assert on it. */
function Trigger({ onOutcome }: { onOutcome: (o: RefreshOutcome) => void }) {
  const trigger = useRefreshTrigger();
  return (
    <button
      onClick={() => {
        void trigger().then(onOutcome);
      }}
    >
      refresh
    </button>
  );
}

function PageHandler({ handler }: { handler: () => Promise<void> | void }) {
  useRefresh(handler);
  return null;
}

describe('RefreshContext triggerRefresh', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves "ok" when every page handler resolves', async () => {
    const outcomes: RefreshOutcome[] = [];
    render(
      <RefreshProvider>
        <PageHandler handler={() => Promise.resolve()} />
        <Trigger onOutcome={(o) => outcomes.push(o)} />
      </RefreshProvider>,
    );

    await act(async () => {
      screen.getByText('refresh').click();
      await Promise.resolve();
    });

    expect(outcomes).toEqual(['ok']);
  });

  it('resolves "failed" when a page handler rejects, without blocking other handlers', async () => {
    const outcomes: RefreshOutcome[] = [];
    let otherRan = false;
    render(
      <RefreshProvider>
        <PageHandler handler={() => Promise.reject(new Error('nope'))} />
        <PageHandler
          handler={() => {
            otherRan = true;
            return Promise.resolve();
          }}
        />
        <Trigger onOutcome={(o) => outcomes.push(o)} />
      </RefreshProvider>,
    );

    await act(async () => {
      screen.getByText('refresh').click();
      await Promise.resolve();
    });

    expect(outcomes).toEqual(['failed']);
    expect(otherRan).toBe(true);
  });

  it('resolves "timeout" when a page handler never settles, after REFRESH_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const outcomes: RefreshOutcome[] = [];
    render(
      <RefreshProvider>
        <PageHandler handler={() => new Promise(() => {})} />
        <Trigger onOutcome={(o) => outcomes.push(o)} />
      </RefreshProvider>,
    );

    act(() => {
      screen.getByText('refresh').click();
    });
    expect(outcomes).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(outcomes).toEqual(['timeout']);
  });

  it('does not let a hung global handler delay triggerRefresh', async () => {
    const outcomes: RefreshOutcome[] = [];
    const neverSettles = () => new Promise<void>(() => {});
    render(
      <RefreshProvider globalRefreshHandlers={[neverSettles]}>
        <PageHandler handler={() => Promise.resolve()} />
        <Trigger onOutcome={(o) => outcomes.push(o)} />
      </RefreshProvider>,
    );

    await act(async () => {
      screen.getByText('refresh').click();
      await Promise.resolve();
    });

    expect(outcomes).toEqual(['ok']);
  });

  it('catches a synchronous throw in a page handler as a rejection', async () => {
    const outcomes: RefreshOutcome[] = [];
    render(
      <RefreshProvider>
        <PageHandler
          handler={() => {
            throw new Error('sync boom');
          }}
        />
        <Trigger onOutcome={(o) => outcomes.push(o)} />
      </RefreshProvider>,
    );

    await act(async () => {
      screen.getByText('refresh').click();
      await Promise.resolve();
    });

    expect(outcomes).toEqual(['failed']);
  });
});
