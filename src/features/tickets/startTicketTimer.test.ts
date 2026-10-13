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
const UPDATE = { postId: 'p1', teamId: 't1' };

beforeEach(() => {
  vi.resetAllMocks();
  createEntry.mockResolvedValue({ entry: {}, session: { id: 's1' }, update: UPDATE } as never);
  setPref.mockResolvedValue({ ok: true });
  addMany.mockResolvedValue({ addedCount: 1 });
});

describe('startTicketTimer', () => {
  it('pins an issue the table does not have, then adds it to My Board', async () => {
    const { outcome, update } = await startTicketTimer(issue, { inTable: false, onBoard: false });
    expect(outcome).toBe('started-and-added');
    // The update the start posted to Huddle comes back with the outcome.
    expect(update).toEqual(UPDATE);
    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: '1234', source: 'redmine', startNow: true }),
    );
    expect(setPref).toHaveBeenCalledWith(1234, 'pinned');
    expect(addMany).toHaveBeenCalledWith([{ sourceId: 'redmine', ticketId: '1234' }]);
  });

  it('only starts the timer when the issue is in the table and on My Board', async () => {
    const { outcome } = await startTicketTimer(issue, { inTable: true, onBoard: true });
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
    const { outcome } = await startTicketTimer(issue, { inTable: false, onBoard: false });
    expect(outcome).toBe('started-pin-limit');
    expect(addMany).not.toHaveBeenCalled();
  });

  it('still adds to My Board when a pin fails for another reason', async () => {
    setPref.mockRejectedValue(new ApiError('down', 503, 'unreachable'));
    expect((await startTicketTimer(issue, { inTable: false, onBoard: false })).outcome).toBe(
      'started-and-added',
    );
  });

  it('reports a plain start when My Board refuses the add', async () => {
    addMany.mockRejectedValue(new Error('nope'));
    expect((await startTicketTimer(issue, { inTable: true, onBoard: false })).outcome).toBe(
      'started',
    );
  });

  it('fails without pinning when no session opened', async () => {
    createEntry.mockResolvedValue({ entry: {}, session: null } as never);
    expect((await startTicketTimer(issue, { inTable: false, onBoard: false })).outcome).toBe(
      'failed',
    );
    expect(setPref).not.toHaveBeenCalled();
  });

  it('passes on a discard of the update of the ticket it takes over from', async () => {
    await startTicketTimer(issue, { inTable: true, onBoard: true, discardSessionId: 's0' });
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ discardSessionId: 's0' }));
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

  it('says only what started, naming a Redmine issue by number and a Huddle ticket by title', () => {
    const toast = makeToast();
    expect(toastTimerOutcome(toast as never, 'started-and-added', '#1234')).toBe(true);
    toastTimerOutcome(toast as never, 'started-on-board', 'Fix login');
    expect(toast.success).toHaveBeenNthCalledWith(1, 'Started #1234', expect.anything());
    expect(toast.success).toHaveBeenNthCalledWith(2, 'Started Fix login', expect.anything());
  });

  it('offers the update as the toast\u2019s action, when there is one', () => {
    const toast = makeToast();
    const viewPost = vi.fn();
    toastTimerOutcome(toast as never, 'started', '#1234', viewPost);
    toastTimerOutcome(toast as never, 'started', '#1234');

    const withPost = toast.success.mock.calls[0][1];
    expect(withPost.action.label).toBe('View post');
    withPost.action.onClick();
    expect(viewPost).toHaveBeenCalled();
    expect(toast.success.mock.calls[1][1].action).toBeUndefined();
  });

  it('warns at the pin cap', () => {
    const toast = makeToast();
    toastTimerOutcome(toast as never, 'started-pin-limit', '#1234');
    expect(toast.warning).toHaveBeenCalled();
  });

  it('confirms a stop', () => {
    const toast = makeToast();
    toastTimerOutcome(toast as never, 'stopped', '#1234');
    expect(toast.info).toHaveBeenCalledWith('Stopped #1234', expect.anything());
  });

  it('shows nothing for a failed or cancelled start, or a pending clock-in', () => {
    expect(toastTimerOutcome(makeToast() as never, 'failed', '#1')).toBe(false);
    expect(toastTimerOutcome(makeToast() as never, 'cancelled', '#1')).toBe(false);
    expect(toastTimerOutcome(makeToast() as never, 'clock-in', '#1')).toBe(false);
  });
});
