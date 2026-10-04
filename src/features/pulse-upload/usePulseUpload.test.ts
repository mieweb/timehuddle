import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { videoApi, type PulseDestination } from '../../lib/api';
import { usePulseUpload } from './usePulseUpload';

vi.mock('@mieweb/ui', () => ({ useOptionalToast: () => null }));
vi.mock('../../lib/api', () => ({
  METEOR_BASE_URL: 'http://localhost:3100',
  videoApi: { reserve: vi.fn(), status: vi.fn() },
}));

const reserve = vi.mocked(videoApi.reserve);
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
  beforeEach(() => reserve.mockReset());

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
    expect(result.current.scanLink).toBeNull();
    expect(result.current.status).toBeNull();
  });
});
