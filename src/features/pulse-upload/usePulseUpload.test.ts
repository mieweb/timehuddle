import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoApi, type PulseDestination } from '../../lib/api';
import { usePulseUpload } from './usePulseUpload';

vi.mock('../../lib/api', () => ({
  TIMECORE_BASE_URL: 'http://localhost:3100',
  videoApi: { reserve: vi.fn(), status: vi.fn() },
}));

const reserve = vi.mocked(videoApi.reserve);
const status = vi.mocked(videoApi.status);
const TICKET_A: PulseDestination = { kind: 'ticket', id: 'a'.repeat(24) };
const TICKET_B: PulseDestination = { kind: 'ticket', id: 'b'.repeat(24) };
const RESERVATION = { videoid: '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59', uploadToken: 'token' };

/** A reserve call that answers only when the test says so. */
function deferredReserve() {
  let answer: (value: typeof RESERVATION) => void = () => {};
  reserve.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)) as never);
  return (value = RESERVATION) => answer(value);
}

describe('usePulseUpload', () => {
  beforeEach(() => {
    reserve.mockReset();
    status.mockReset();
    status.mockResolvedValue({ state: 'waiting' });
  });
  afterEach(() => vi.useRealTimers());

  it('opens the link for the destination Pulse was pressed on', async () => {
    const answer = deferredReserve();
    const { result } = renderHook(() => usePulseUpload(TICKET_A));

    await act(async () => {
      const started = result.current.start();
      answer();
      await started;
    });

    expect(reserve).toHaveBeenCalledWith(TICKET_A);
    expect(result.current.modalOpen).toBe(true);
    expect(result.current.link?.videoid).toBe(RESERVATION.videoid);
    expect(result.current.status).toEqual({ state: 'waiting' });
  });

  it('drops a link that comes back after the destination changed', async () => {
    const answer = deferredReserve();
    const { result, rerender } = renderHook(({ destination }) => usePulseUpload(destination), {
      initialProps: { destination: TICKET_A },
    });

    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start();
    });
    rerender({ destination: TICKET_B });
    await act(async () => {
      answer();
      await started;
    });

    expect(result.current.modalOpen).toBe(false);
    expect(result.current.link).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it("keeps a failed reservation's error off the destination that replaced it", async () => {
    let fail: (reason: Error) => void = () => {};
    reserve.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)) as never);
    const { result, rerender } = renderHook(({ destination }) => usePulseUpload(destination), {
      initialProps: { destination: TICKET_A },
    });

    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start();
    });
    rerender({ destination: TICKET_B });
    await act(async () => {
      fail(new Error('Ticket not found'));
      await started;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.reserving).toBe(false);
  });

  it('reopens the live link instead of minting a second one', async () => {
    reserve.mockResolvedValueOnce(RESERVATION);
    const { result } = renderHook(() => usePulseUpload(TICKET_A));

    await act(() => result.current.start());
    await act(() => result.current.start());

    expect(reserve).toHaveBeenCalledTimes(1);
    expect(result.current.modalOpen).toBe(true);
  });

  it('closes the modal a moment after the video lands, with the backend note or not', async () => {
    vi.useFakeTimers();
    reserve.mockResolvedValueOnce(RESERVATION);
    status.mockResolvedValue({ state: 'done', note: 'Attached to ticket ' + TICKET_A.id });
    const onSettled = vi.fn();
    const { result } = renderHook(() => usePulseUpload(TICKET_A, { onSettled }));

    await act(() => result.current.start());
    expect(result.current.modalOpen).toBe(true);

    // The next poll learns it landed; the modal closes 1.5 s later and the host hears.
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.status?.state).toBe('done');
    expect(result.current.modalOpen).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.modalOpen).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('asks once at a time, and stops asking when it unmounts', async () => {
    vi.useFakeTimers();
    reserve.mockResolvedValueOnce(RESERVATION);
    const signals: AbortSignal[] = [];
    // A server that never answers.
    status.mockImplementation((_id, _token, signal) => {
      signals.push(signal!);
      return new Promise(() => {});
    });
    const { result, unmount } = renderHook(() => usePulseUpload(TICKET_A));

    await act(() => result.current.start());
    await act(() => vi.advanceTimersByTimeAsync(3000 * 3));
    expect(status).toHaveBeenCalledTimes(1);

    unmount();
    expect(signals[0].aborted).toBe(true);
  });
});
