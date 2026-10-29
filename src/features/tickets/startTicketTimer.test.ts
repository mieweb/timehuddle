import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, myBoardApi, ticketApi, timerApi } from '../../lib/api';

import { NoTeamError } from './carryIssue';
import { startTicketTimer, timerErrorMessage, toastTimerOutcome } from './startTicketTimer';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ApiError: actual.ApiError,
    timerApi: { createEntry: vi.fn() },
    myBoardApi: { addMany: vi.fn() },
    ticketApi: { carryIssue: vi.fn() },
  };
});

const createEntry = vi.mocked(timerApi.createEntry);
const addMany = vi.mocked(myBoardApi.addMany);
const carryIssue = vi.mocked(ticketApi.carryIssue);

const issue = { sourceId: 'redmine' as const, id: '1234' };
const huddleTicket = { sourceId: 'huddle' as const, id: 'abc' };
const UPDATE = { postId: 'p1', teamId: 't1' };

beforeEach(() => {
  vi.resetAllMocks();
  createEntry.mockResolvedValue({ entry: {}, session: { id: 's1' }, update: UPDATE } as never);
  addMany.mockResolvedValue({ addedCount: 1 });
  carryIssue.mockResolvedValue({ ticket: { id: 'carrier1' }, created: true } as never);
});

const TEAM = 'team1';

describe('startTicketTimer: a Redmine issue is timed as the ticket carrying it (#736)', () => {
  it('times the carrying ticket, and puts that on My Board', async () => {
    const { outcome } = await startTicketTimer(issue, {
      onBoard: true,
      teamId: TEAM,
    });
    expect(carryIssue).toHaveBeenCalledWith(TEAM, '1234');
    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'carrier1', source: 'huddle', startNow: true }),
    );
    // The issue was on the board, not necessarily its carrier.
    expect(addMany).toHaveBeenCalledWith([{ sourceId: 'huddle', ticketId: 'carrier1' }]);
    expect(outcome).toBe('started-and-added');
  });

  it('starts nothing without a team to put the ticket in', async () => {
    await expect(startTicketTimer(issue, { onBoard: true, teamId: null })).rejects.toBeInstanceOf(
      NoTeamError,
    );
    expect(createEntry).not.toHaveBeenCalled();
  });

  it('starts nothing when the issue cannot be carried', async () => {
    carryIssue.mockRejectedValue(new ApiError('gone', 404, 'issue-unavailable'));
    await expect(startTicketTimer(issue, { onBoard: true, teamId: TEAM })).rejects.toThrow('gone');
    expect(createEntry).not.toHaveBeenCalled();
  });

  it('never carries a Huddle ticket', async () => {
    await startTicketTimer(huddleTicket, { onBoard: true, teamId: TEAM });
    expect(carryIssue).not.toHaveBeenCalled();
  });
});

describe('startTicketTimer', () => {
  it('starts the timer and adds the ticket to My Board', async () => {
    const { outcome, update } = await startTicketTimer(huddleTicket, {
      onBoard: false,
      teamId: TEAM,
    });
    expect(outcome).toBe('started-and-added');
    // The update the start posted to Huddle comes back with the outcome.
    expect(update).toEqual(UPDATE);
    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'abc', source: 'huddle', startNow: true }),
    );
    expect(addMany).toHaveBeenCalledWith([{ sourceId: 'huddle', ticketId: 'abc' }]);
  });

  it('only starts the timer when the ticket is on My Board', async () => {
    const { outcome } = await startTicketTimer(huddleTicket, { onBoard: true, teamId: TEAM });
    expect(outcome).toBe('started-on-board');
    expect(addMany).not.toHaveBeenCalled();
  });

  it('reports a plain start when My Board refuses the add', async () => {
    addMany.mockRejectedValue(new Error('nope'));
    expect((await startTicketTimer(huddleTicket, { onBoard: false, teamId: TEAM })).outcome).toBe(
      'started',
    );
  });

  it('fails when no session opened', async () => {
    createEntry.mockResolvedValue({ entry: {}, session: null } as never);
    expect((await startTicketTimer(huddleTicket, { onBoard: false, teamId: TEAM })).outcome).toBe(
      'failed',
    );
    expect(addMany).not.toHaveBeenCalled();
  });

  it('passes on a discard of the update of the ticket it takes over from', async () => {
    await startTicketTimer(huddleTicket, { onBoard: true, teamId: TEAM, discardSessionId: 's0' });
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ discardSessionId: 's0' }));
  });

  it('throws when the timer itself is refused', async () => {
    createEntry.mockRejectedValue(new ApiError('shift', 400, 'no-active-shift'));
    await expect(startTicketTimer(huddleTicket, { onBoard: true, teamId: TEAM })).rejects.toThrow();
  });
});

describe('timerErrorMessage', () => {
  it('asks for a team when a Redmine issue had none to become a ticket in', () => {
    expect(timerErrorMessage(new NoTeamError())).toMatch(/Choose a team first/);
  });

  it('says when the issue is gone or out of reach', () => {
    expect(timerErrorMessage(new ApiError('x', 404, 'issue-unavailable'))).toMatch(
      /doesn't exist, or you don't have access/,
    );
  });

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
