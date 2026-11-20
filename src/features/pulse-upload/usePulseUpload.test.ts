import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoApi, type PulseDestination } from '../../lib/api';
import { openExternalUrl } from '../../lib/device';
import { usePulseUpload } from './usePulseUpload';
import { uploadVideoFile } from './videoFile';

vi.mock('../../lib/api', () => ({
  TIMECORE_BASE_URL: 'http://localhost:3100',
  videoApi: { reserve: vi.fn(), status: vi.fn() },
}));

// Where a link opened on the phone itself says to come back to.
vi.mock('../../lib/useCopyLink', () => ({
  absoluteAppUrl: (path: string) => `https://huddle.example.org${path}`,
}));

// A computer's browser unless a test says otherwise.
const device = vi.hoisted(() => ({ phoneBrowser: false, nativeApp: false }));
vi.mock('../../lib/device', () => ({
  isMobileBrowser: () => device.phoneBrowser,
  isNativeApp: () => device.nativeApp,
  openExternalUrl: vi.fn(),
}));
const openExternal = vi.mocked(openExternalUrl);

// The tus upload itself is stubbed; the file checks stay real.
vi.mock('./videoFile', async (importActual) => ({
  ...(await importActual<typeof import('./videoFile')>()),
  uploadVideoFile: vi.fn(),
}));
const sendFile = vi.mocked(uploadVideoFile);

const reserve = vi.mocked(videoApi.reserve);
const status = vi.mocked(videoApi.status);
const TICKET_A: PulseDestination = { kind: 'ticket', id: 'a'.repeat(24) };
const TICKET_B: PulseDestination = { kind: 'ticket', id: 'b'.repeat(24) };
const RESERVATION = { videoid: '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59', uploadToken: 'token' };
/** A reservation for a place Pulse keeps a draft for. */
const PLACE = {
  ...RESERVATION,
  ref: 'Zm9vYmFyYmF6cXV4MQ',
  label: 'Fix the login page',
  name: 'Fix the login page',
};

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

  it("puts the place's label and name on a QR link, and nothing about this page", async () => {
    reserve.mockResolvedValueOnce(PLACE);
    const { result } = renderHook(() => usePulseUpload(TICKET_A));

    await act(() => result.current.start());

    expect(result.current.modalOpen).toBe(true);
    const params = new URLSearchParams(new URL(result.current.link!.url).hash.slice(1));
    expect(params.get('artifactId')).toBe(RESERVATION.videoid);
    expect(params.get('token')).toBe(RESERVATION.uploadToken);
    expect(params.get('label')).toBe('Fix the login page');
    expect(params.get('name')).toBe('Fix the login page');
    // Scanned from another screen: no way back, and the place's key stays in the token.
    expect(params.has('app')).toBe(false);
    expect(params.has('return')).toBe(false);
    expect(params.has('ref')).toBe(false);
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

    it('opens a link that says who sent it and the page to come back to', async () => {
      vi.stubGlobal('location', {
        assign,
        pathname: '/app/tickets',
        search: '?team=t1&status=open&q=private+search',
      });
      reserve.mockResolvedValueOnce(PLACE);
      const { result } = renderHook(() => usePulseUpload(TICKET_A));
      await act(async () => {});

      await act(() => result.current.start());

      const params = new URLSearchParams(new URL(assign.mock.calls[0][0]).hash.slice(1));
      expect(params.get('label')).toBe('Fix the login page');
      expect(params.get('app')).toBe('TimeHuddle');
      // The page and its team; what was searched or filtered for stays off the link.
      expect(params.get('return')).toBe('https://huddle.example.org/app/tickets?team=t1');
      expect(params.has('ref')).toBe(false);
    });

    it('with prepare off (a row off screen), reserves only on the tap, then offers the window', async () => {
      reserve.mockReset();
      const { result } = renderHook(() => usePulseUpload(TICKET_A, { prepare: false }));
      await act(async () => {});
      expect(reserve).not.toHaveBeenCalled();

      reserve.mockResolvedValueOnce(RESERVATION);
      await act(() => result.current.start());

      // The tap was spent on the server: "Open Pulse" in the window, not a navigation.
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
      expect(result.current.modalOpen).toBe(true);
    });

    it('keeps its link ready while its row is off screen, and reserves nothing when it comes back', async () => {
      reserve.mockReset();
      reserve.mockResolvedValueOnce(RESERVATION);
      const { result, rerender } = renderHook(
        ({ prepare }) => usePulseUpload(TICKET_A, { prepare }),
        { initialProps: { prepare: true } },
      );
      await act(async () => {});
      expect(reserve).toHaveBeenCalledTimes(1);

      rerender({ prepare: false });
      rerender({ prepare: true });
      await act(async () => {});
      expect(reserve).toHaveBeenCalledTimes(1);

      // Still one tap, with the link it had.
      reserve.mockResolvedValue(SECOND);
      await act(() => result.current.start());
      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign.mock.calls[0][0]).toContain(RESERVATION.videoid);
    });

    it('reserves a new link for a row that comes back after its link went stale', async () => {
      vi.useFakeTimers();
      reserve.mockReset();
      // Each use prepares the next link.
      reserve.mockResolvedValue({ videoid: 'next', uploadToken: 'next' });
      reserve.mockResolvedValueOnce(RESERVATION).mockResolvedValueOnce(SECOND);
      const { result, rerender } = renderHook(
        ({ prepare }) => usePulseUpload(TICKET_A, { prepare }),
        { initialProps: { prepare: true } },
      );
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(reserve).toHaveBeenCalledTimes(1);

      // Off screen, nothing is refreshed.
      rerender({ prepare: false });
      await act(() => vi.advanceTimersByTimeAsync(21 * 60 * 1000));
      expect(reserve).toHaveBeenCalledTimes(1);

      rerender({ prepare: true });
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(reserve).toHaveBeenCalledTimes(2);
      await act(() => result.current.start());
      expect(assign.mock.calls[0][0]).toContain(SECOND.videoid);
    });

    it('refreshes a link that stays on screen for 20 minutes', async () => {
      vi.useFakeTimers();
      reserve.mockReset();
      reserve.mockResolvedValueOnce(RESERVATION).mockResolvedValueOnce(SECOND);
      renderHook(() => usePulseUpload(TICKET_A));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(reserve).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(20 * 60 * 1000));
      expect(reserve).toHaveBeenCalledTimes(2);
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

  it("keeps an earlier file upload's progress and failure off the destination that replaced it", async () => {
    reserve.mockResolvedValueOnce(RESERVATION);
    let report: (fraction: number) => void = () => {};
    let fail: (reason: Error) => void = () => {};
    sendFile.mockImplementationOnce((_file, _reservation, onProgress) => {
      report = onProgress ?? (() => {});
      return new Promise((_, reject) => (fail = reject));
    });
    const { result, rerender } = renderHook(({ destination }) => usePulseUpload(destination), {
      initialProps: { destination: TICKET_A },
    });

    let sending: Promise<void> = Promise.resolve();
    await act(async () => {
      sending = result.current.upload(new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
    });
    act(() => report(0.4));
    expect(result.current.progress).toBe(0.4);

    // The host moves on: ticket B's buttons are free at once.
    rerender({ destination: TICKET_B });
    expect(result.current.progress).toBeNull();

    // Ticket A's upload still reports, then fails; ticket B hears none of it.
    act(() => report(0.9));
    await act(async () => {
      fail(new Error("The upload didn't finish."));
      await sending;
    });
    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
