import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TicketPulseButton } from './TicketPulseButton';

// The chip itself is PulseButton's; here only what the row tells it.
vi.mock('../pulse-upload/PulseButton', () => ({
  PulseButton: ({ prepare, ariaLabel }: { prepare?: boolean; ariaLabel: string }) => (
    <button aria-label={ariaLabel} data-prepare={String(prepare)} />
  ),
}));

/** Tell the row's observer where the row is: one entry per change, oldest first. */
let report: (...intersecting: boolean[]) => void = () => {};

const chip = () => screen.getByRole('button', { name: 'Record a video for Fix login with Pulse' });
const prepared = () => chip().getAttribute('data-prepare');

describe('TicketPulseButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = (...intersecting) =>
            act(() => callback(intersecting.map((isIntersecting) => ({ isIntersecting }))));
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('has a link prepared only once its row has stayed on screen a moment', () => {
    render(<TicketPulseButton ticketId="t1" title="Fix login" />);
    expect(prepared()).toBe('false');

    report(true);
    act(() => vi.advanceTimersByTime(299));
    expect(prepared()).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(prepared()).toBe('true');

    // Gone the moment it leaves.
    report(false);
    expect(prepared()).toBe('false');
  });

  it('prepares nothing for a row flicked past', () => {
    render(<TicketPulseButton ticketId="t1" title="Fix login" />);
    report(true);
    act(() => vi.advanceTimersByTime(200));
    report(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(prepared()).toBe('false');
  });

  it('goes by where the row is now when several changes arrive at once', () => {
    render(<TicketPulseButton ticketId="t1" title="Fix login" />);
    report(true, false);
    act(() => vi.advanceTimersByTime(1000));
    expect(prepared()).toBe('false');

    report(false, true);
    act(() => vi.advanceTimersByTime(300));
    expect(prepared()).toBe('true');
  });

  it('keeps its clicks from the row, which opens the ticket on one', () => {
    const openTicket = vi.fn();
    render(
      <div onClick={openTicket}>
        <TicketPulseButton ticketId="t1" title="Fix login" />
      </div>,
    );
    fireEvent.click(chip());
    expect(openTicket).not.toHaveBeenCalled();
  });
});
