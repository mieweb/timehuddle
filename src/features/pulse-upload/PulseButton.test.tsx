import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PulseChip } from './PulseButton';
import { EXPIRED_MESSAGE, keptMessage } from './pulseStatus';
import type { PulseUpload } from './usePulseUpload';

/** A Pulse upload as usePulseUpload hands it out, idle unless told otherwise. */
const pulseWith = (over: Partial<PulseUpload> = {}): PulseUpload => ({
  destination: { kind: 'ticket', id: 'a'.repeat(24) },
  start: vi.fn(async () => {}),
  upload: vi.fn(async () => {}),
  reserving: false,
  progress: null,
  processing: false,
  error: null,
  link: null,
  status: null,
  modalOpen: false,
  closeModal: vi.fn(),
  ...over,
});

/** Whether the device has a pointer that hovers. */
function hover(can: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(hover: none)' ? !can : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

const LABEL = 'Record a video for Fix login with Pulse';
const chip = () => screen.getByRole('button', { name: LABEL });
// Until it has measured where to sit (a frame later) the tooltip is there but not yet visible.
const tooltip = () => screen.queryByRole('tooltip', { hidden: true });
const ERROR = 'Ticket not found';
const KEPT = keptMessage('Ticket not found — it was gone before the video finished uploading.');

describe('PulseChip, the logo alone on a row', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hover(true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const row = (pulse: PulseUpload) => (
    <PulseChip pulse={pulse} ariaLabel={LABEL} compact="always" />
  );

  it('names itself in a tooltip on keyboard focus', () => {
    render(row(pulseWith()));
    expect(tooltip()).toBeNull();
    fireEvent.focus(chip());
    expect(tooltip()?.textContent).toBe('Record with Pulse');
  });

  it.each([
    ['what went wrong', { error: ERROR }, ERROR, 'alert'],
    [
      'a video kept elsewhere',
      {
        status: {
          state: 'kept',
          reason: 'Ticket not found — it was gone before the video finished uploading.',
        },
      },
      KEPT,
      'status',
    ],
  ] as const)(
    'says %s in its tooltip, which comes up by itself for a while, never beside the chip',
    (_what, state, words, role) => {
      const { rerender } = render(row(pulseWith()));
      rerender(row(pulseWith(state)));

      // Announced, but not laid out in the row.
      expect(screen.getByRole(role).textContent).toBe(words);
      expect(screen.getByRole(role).className).toContain('sr-only');
      expect(tooltip()?.textContent).toBe(words);

      act(() => vi.advanceTimersByTime(6000));
      expect(tooltip()).toBeNull();
      // Still there for whoever goes back to the chip.
      fireEvent.focus(chip());
      expect(tooltip()?.textContent).toBe(words);
    },
  );

  it('takes an alert down after its six seconds, whatever the pointer did meanwhile', () => {
    const { rerender } = render(row(pulseWith()));
    // Hovering: the chip names itself.
    fireEvent.mouseEnter(chip().parentElement!);
    act(() => vi.advanceTimersByTime(200));
    expect(tooltip()?.textContent).toBe('Record with Pulse');

    // Pressed, and Pulse didn't start; the pointer moves off while the reason is up.
    fireEvent.click(chip());
    rerender(row(pulseWith({ error: ERROR })));
    expect(tooltip()?.textContent).toBe(ERROR);
    fireEvent.mouseLeave(chip().parentElement!);
    act(() => vi.advanceTimersByTime(3000));
    expect(tooltip()?.textContent).toBe(ERROR);

    act(() => vi.advanceTimersByTime(3000));
    expect(tooltip()).toBeNull();
    // And it still answers to the pointer afterwards.
    fireEvent.mouseEnter(chip().parentElement!);
    act(() => vi.advanceTimersByTime(200));
    expect(tooltip()?.textContent).toBe(ERROR);
    fireEvent.mouseLeave(chip().parentElement!);
    act(() => vi.advanceTimersByTime(100));
    expect(tooltip()).toBeNull();
  });

  it('takes it down after the six seconds for a pointer still on the chip, until it comes back', () => {
    const { rerender } = render(row(pulseWith()));
    fireEvent.mouseEnter(chip().parentElement!);
    act(() => vi.advanceTimersByTime(200));
    rerender(row(pulseWith({ error: ERROR })));
    act(() => vi.advanceTimersByTime(6000));
    expect(tooltip()).toBeNull();

    fireEvent.mouseLeave(chip().parentElement!);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseEnter(chip().parentElement!);
    act(() => vi.advanceTimersByTime(200));
    expect(tooltip()?.textContent).toBe(ERROR);
  });

  it('takes it down after the six seconds for keyboard focus still on the chip, until it comes back', () => {
    const { rerender } = render(row(pulseWith()));
    act(() => chip().focus());
    rerender(row(pulseWith({ error: ERROR })));
    act(() => vi.advanceTimersByTime(6000));
    expect(tooltip()).toBeNull();

    act(() => chip().blur());
    act(() => chip().focus());
    expect(tooltip()?.textContent).toBe(ERROR);
  });

  it('never shows over the QR window, opened by keyboard or by pointer', () => {
    const { rerender } = render(row(pulseWith()));
    fireEvent.focus(chip());
    expect(tooltip()?.textContent).toBe('Record with Pulse');
    // Enter: the window opens, and the chip may or may not be told it lost focus.
    rerender(row(pulseWith({ modalOpen: true, status: { state: 'waiting' } })));
    expect(tooltip()).toBeNull();
  });

  it('shows them where there is no hover too, and no tooltip otherwise', () => {
    hover(false);
    const { rerender } = render(row(pulseWith()));
    fireEvent.focus(chip());
    expect(tooltip()).toBeNull();

    rerender(row(pulseWith({ error: ERROR })));
    expect(tooltip()?.textContent).toBe(ERROR);
    act(() => vi.advanceTimersByTime(6000));
    expect(tooltip()).toBeNull();
  });

  it('keeps a link that expired to its tooltip: nothing comes up by itself', () => {
    const { rerender } = render(row(pulseWith()));
    rerender(row(pulseWith({ status: { state: 'expired' } })));
    expect(tooltip()).toBeNull();
    expect(screen.getByRole('status').className).toContain('sr-only');
    fireEvent.focus(chip());
    expect(tooltip()?.textContent).toBe(EXPIRED_MESSAGE);
  });
});

describe('PulseChip, with its label', () => {
  beforeEach(() => hover(true));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('says what went wrong beside the chip, as before', () => {
    render(<PulseChip pulse={pulseWith({ error: ERROR })} ariaLabel="Add a video with Pulse" />);
    expect(screen.getByRole('alert').textContent).toBe(ERROR);
    expect(screen.getByRole('alert').className).not.toContain('sr-only');
    expect(tooltip()).toBeNull();

    cleanup();
    render(
      <PulseChip
        pulse={pulseWith({ status: { state: 'expired' } })}
        ariaLabel="Add a video with Pulse"
        compact
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(EXPIRED_MESSAGE);
    expect(screen.getByRole('status').className).not.toContain('sr-only');
  });
});
