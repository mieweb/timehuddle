import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, myBoardApi, redmineApi, timerApi } from '../../lib/api';

import { startTicketTimer, timerErrorMessage, toastTimerOutcome } from './startTicketTimer';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ApiError: actual.ApiError,
    timerApi: { createEntry: vi.fn() },
    redmineApi: { prefs: { set: vi.fn() } },
    myBoardApi: { addMany: vi.fn() },
  };
});

const createEntry = vi.mocked(timerApi.createEntry);
const setPref = vi.mocked(redmineApi.prefs.set);
const addMany = vi.mocked(myBoardApi.addMany);

const issue = { sourceId: 'redmine' as const, id: '1234' };
const huddleTicket = { sourceId: 'huddle' as const, id: 'abc' };

beforeEach(() => {
  vi.resetAllMocks();
  createEntry.mockResolvedValue({ entry: {}, session: { id: 's1' } } as never);
  setPref.mockResolvedValue({ ok: true });
  addMany.mockResolvedValue({ addedCount: 1 });
});

describe('startTicketTimer', () => {
  it('pins an issue the table does not have, then adds it to My Board', async () => {
    const outcome = await startTicketTimer(issue, { inTable: false, onBoard: false });
    expect(outcome).toBe('started-and-added');
    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: '1234', source: 'redmine', startNow: true }),
    );
    expect(setPref).toHaveBeenCalledWith(1234, 'pinned');
    expect(addMany).toHaveBeenCalledWith([{ sourceId: 'redmine', ticketId: '1234' }]);
  });

  it('only starts the timer when the issue is in the table and on My Board', async () => {
    const outcome = await startTicketTimer(issue, { inTable: true, onBoard: true });
    expect(outcome).toBe('started-on-board');
    expect(setPref).not.toHaveBeenCalled();
    expect(addMany).not.toHaveBeenCalled();
  });

  it('never pins a Huddle ticket', async () => {
    await startTicketTimer(huddleTicket, { inTable: false, onBoard: false });
    expect(setPref).not.toHaveBeenCalled();
  });

  it('keeps the issue off My Board at the pin cap', async () => {
    setPref.mockRejectedValue(new ApiError('cap', 400, 'too-many-pins'));
    const outcome = await startTicketTimer(issue, { inTable: false, onBoard: false });
    expect(outcome).toBe('started-pin-limit');
    expect(addMany).not.toHaveBeenCalled();
  });

  it('still adds to My Board when a pin fails for another reason', async () => {
    setPref.mockRejectedValue(new ApiError('down', 503, 'unreachable'));
    expect(await startTicketTimer(issue, { inTable: false, onBoard: false })).toBe(
      'started-and-added',
    );
  });

  it('reports a plain start when My Board refuses the add', async () => {
    addMany.mockRejectedValue(new Error('nope'));
    expect(await startTicketTimer(issue, { inTable: true, onBoard: false })).toBe('started');
  });

  it('fails without pinning when no session opened', async () => {
    createEntry.mockResolvedValue({ entry: {}, session: null } as never);
    expect(await startTicketTimer(issue, { inTable: false, onBoard: false })).toBe('failed');
    expect(setPref).not.toHaveBeenCalled();
  });

  it('throws when the timer itself is refused', async () => {
    createEntry.mockRejectedValue(new ApiError('shift', 400, 'no-active-shift'));
    await expect(startTicketTimer(issue, { inTable: true, onBoard: true })).rejects.toThrow();
  });
});

describe('timerErrorMessage', () => {
  it('asks the user to clock in when there is no shift', () => {
    expect(timerErrorMessage(new ApiError('x', 400, 'no-active-shift'))).toBe(
      'Clock in to start a ticket timer.',
    );
  });

  it('falls back to a generic retry', () => {
    expect(timerErrorMessage(new Error('x'))).toBe('Could not start the timer. Please try again.');
  });
});

describe('toastTimerOutcome', () => {
  const makeToast = () => ({ success: vi.fn(), warning: vi.fn(), info: vi.fn() });

  it('names a Redmine issue by number and a Huddle ticket by title', () => {
    const toast = makeToast();
    expect(toastTimerOutcome(toast as never, 'started-and-added', '#1234')).toBe(true);
    toastTimerOutcome(toast as never, 'started', 'Fix login');
    expect(toast.success).toHaveBeenNthCalledWith(
      1,
      'Timer started on #1234 and added to My Board',
    );
    expect(toast.success).toHaveBeenNthCalledWith(2, 'Timer started on Fix login');
  });

  it('names the ticket whose timer the start stopped', () => {
    const toast = makeToast();
    toastTimerOutcome(toast as never, 'started-on-board', '#1234', 'Fix login');
    expect(toast.success).toHaveBeenCalledWith(
      "Stopped Fix login. Timer started on #1234. It's on My Board",
    );
  });

  it('warns at the pin cap', () => {
    const toast = makeToast();
    toastTimerOutcome(toast as never, 'started-pin-limit', '#1234');
    expect(toast.warning).toHaveBeenCalled();
  });

  it('confirms a stop without a switch message', () => {
    const toast = makeToast();
    toastTimerOutcome(toast as never, 'stopped', '#1234', 'ignored');
    expect(toast.info).toHaveBeenCalledWith('Timer stopped on #1234');
  });

  it('shows nothing for a failed start or a pending clock-in', () => {
    expect(toastTimerOutcome(makeToast() as never, 'failed', '#1')).toBe(false);
    expect(toastTimerOutcome(makeToast() as never, 'clock-in', '#1')).toBe(false);
  });
});
