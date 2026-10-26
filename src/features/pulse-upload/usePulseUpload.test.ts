import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoApi, type PulseDestination } from '../../lib/api';
import { openExternalUrl } from '../../lib/device';
import { usePulseUpload } from './usePulseUpload';

vi.mock('../../lib/api', () => ({
  TIMECORE_BASE_URL: 'http://localhost:3100',
  videoApi: { reserve: vi.fn(), status: vi.fn() },
}));

// A computer's browser unless a test says otherwise.
const device = vi.hoisted(() => ({ phoneBrowser: false, nativeApp: false }));
vi.mock('../../lib/device', () => ({
  isMobileBrowser: () => device.phoneBrowser,
  isNativeApp: () => device.nativeApp,
  openExternalUrl: vi.fn(),
}));
const openExternal = vi.mocked(openExternalUrl);

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
    openExternal.mockReset();
    device.phoneBrowser = false;
    device.nativeApp = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  describe("in a phone's browser", () => {
    const SECOND = { videoid: '1c8f8d2f-6b40-4d2e-8f3b-7a2e3d4c5b6a', uploadToken: 'token-2' };
    let assign: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      device.phoneBrowser = true;
      // Each use prepares the next link.
      reserve.mockResolvedValue({ videoid: 'next', uploadToken: 'next' });
      assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign });
    });

    it('starts from the prepared link and clears an earlier error', async () => {
      reserve.mockResolvedValueOnce(RESERVATION);
      const { result } = renderHook(() => usePulseUpload(TICKET_A));
      await act(async () => {});
      const tooLarge = new File(['x'], 'long.mp4', { type: 'video/mp4' });
      Object.defineProperty(tooLarge, 'size', { value: 600 * 1024 * 1024 });
      await act(() => result.current.upload(tooLarge));
      expect(result.current.error).toBe('That file is larger than 500 MB.');

      await act(() => result.current.start());

      expect(result.current.error).toBeNull();
      expect(result.current.link?.videoid).toBe(RESERVATION.videoid);
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it('prepares a new link when the prepare key changes, and uses that one', async () => {
      reserve.mockResolvedValueOnce(RESERVATION).mockResolvedValueOnce(SECOND);
      const { result, rerender } = renderHook(
        ({ prepareKey }) => usePulseUpload(TICKET_A, { prepareKey }),
        { initialProps: { prepareKey: '' } },
      );
      await act(async () => {});
      rerender({ prepareKey: 'shift-1' });
      await act(async () => {});
      expect(reserve).toHaveBeenCalledTimes(2);

      await act(() => result.current.start());

      expect(result.current.link?.videoid).toBe(SECOND.videoid);
    });

    it('never goes back to a link prepared before the key changed and changed back', async () => {
      // '' → shift-1: its link fails; shift-1 → '': its link hasn't arrived.
      reserve
        .mockResolvedValueOnce(RESERVATION)
        .mockRejectedValueOnce(new Error('offline'))
        .mockReturnValueOnce(new Promise(() => {}) as never)
        .mockResolvedValueOnce(SECOND);
      const { result, rerender } = renderHook(
        ({ prepareKey }) => usePulseUpload(TICKET_A, { prepareKey }),
        { initialProps: { prepareKey: '' } },
      );
      await act(async () => {});
      rerender({ prepareKey: 'shift-1' });
      await act(async () => {});
      rerender({ prepareKey: '' });
      await act(async () => {});

      await act(() => result.current.start());

      // Not the pre-shift link: a fresh one, reserved at the tap.
      expect(result.current.link?.videoid).toBe(SECOND.videoid);
    });
  });

  it('in the app, cancels a launch still loading once the destination changes', async () => {
    device.nativeApp = true;
    reserve.mockResolvedValueOnce(RESERVATION);
    // The launcher is still loading.
    openExternal.mockReturnValueOnce(new Promise(() => {}));
    const { result, rerender } = renderHook(({ destination }) => usePulseUpload(destination), {
      initialProps: { destination: TICKET_A },
    });

    act(() => void result.current.start());
    await act(async () => {});
    const signal = openExternal.mock.calls[0][1]!;
    expect(signal.aborted).toBe(false);

    rerender({ destination: TICKET_B });
    expect(signal.aborted).toBe(true);
  });
});
