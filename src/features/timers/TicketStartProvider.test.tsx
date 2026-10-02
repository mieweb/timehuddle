import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, timerApi } from '../../lib/api';
import { useClockToggle } from '../../lib/useClockToggle';
import { useRunningTicket, type RunningTicket } from '../../lib/useRunningTicket';
import { startTicketTimer } from '../tickets/startTicketTimer';

import {
  TicketStartProvider,
  useTicketStart,
  type TicketStartRequest,
} from './TicketStartProvider';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const toast = { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() };
vi.mock('@mieweb/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mieweb/ui')>()),
  useToast: () => toast,
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ApiError: actual.ApiError,
    timerApi: { startSession: vi.fn(), stopSession: vi.fn() },
  };
});

vi.mock('../tickets/startTicketTimer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tickets/startTicketTimer')>()),
  startTicketTimer: vi.fn(),
}));

vi.mock('../tickets/sources', () => ({ invalidateRedmineCache: vi.fn() }));
vi.mock('../../lib/useClockToggle', () => ({ useClockToggle: vi.fn() }));
vi.mock('../../lib/useRunningTicket', () => ({ useRunningTicket: vi.fn() }));
vi.mock('../../lib/TeamContext', () => ({ useTeam: () => ({ selectedTeamId: 'team1' }) }));

const navigate = vi.fn();
vi.mock('../../ui/router', () => ({
  useRouter: () => ({ pathname: '/app/tickets', navigate }),
}));

const mockStart = vi.mocked(startTicketTimer);
const mockClockToggle = vi.mocked(useClockToggle);
const mockRunning = vi.mocked(useRunningTicket);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clock = { isClockedIn: true, planMissing: false, clockIn: vi.fn() };
let running: RunningTicket | null = null;

function applyMocks() {
  mockClockToggle.mockReturnValue({
    isClockedIn: clock.isClockedIn,
    clockIn: clock.clockIn,
    clockInLoading: false,
    planGate: { planMissing: clock.planMissing },
  } as unknown as ReturnType<typeof useClockToggle>);
  mockRunning.mockReturnValue(running);
}

const redmineStart: TicketStartRequest = {
  kind: 'ticket',
  ticket: { sourceId: 'redmine', id: '15' },
  label: '#15',
  inTable: true,
  onBoard: false,
};

function renderProvider() {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TicketStartProvider>{children}</TicketStartProvider>
  );
  return renderHook(() => useTicketStart(), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  clock.isClockedIn = true;
  clock.planMissing = false;
  clock.clockIn.mockResolvedValue(true);
  running = null;
  mockStart.mockResolvedValue('started-and-added');
  vi.mocked(timerApi.startSession).mockResolvedValue({} as never);
  applyMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TicketStartProvider', () => {
  it('starts right away when clocked in, and confirms it', async () => {
    const { result } = renderProvider();

    let outcome;
    await act(async () => {
      outcome = await result.current.start(redmineStart);
    });

    expect(outcome).toBe('started-and-added');
    expect(mockStart).toHaveBeenCalledWith({ sourceId: 'redmine', id: '15' }, redmineStart);
    expect(toast.success).toHaveBeenCalledWith('Timer started on #15 and added to My Board');
  });

  it('names the ticket whose timer it stopped', async () => {
    running = {
      key: 'huddle:abc',
      source: 'huddle',
      id: 'abc',
      title: 'Fix login',
      url: null,
      sessionId: 's0',
    };
    applyMocks();
    const { result } = renderProvider();

    await act(async () => {
      await result.current.start(redmineStart);
    });

    expect(toast.success).toHaveBeenCalledWith(
      'Stopped Fix login. Timer started on #15 and added to My Board',
    );
  });

  it('starts a Work page entry by its session', async () => {
    const { result } = renderProvider();

    await act(async () => {
      await result.current.start({
        kind: 'entry',
        entryId: 'w1',
        ticketKey: 'huddle:abc',
        label: 'Fix login',
      });
    });

    expect(timerApi.startSession).toHaveBeenCalledWith('w1', expect.any(Number));
    expect(toast.success).toHaveBeenCalledWith('Timer started on Fix login');
  });

  it('shows why a start was refused', async () => {
    mockStart.mockRejectedValue(new ApiError('no shift', 400, 'no-active-shift'));
    const { result } = renderProvider();

    await act(async () => {
      await result.current.start(redmineStart);
    });

    expect(toast.error).toHaveBeenCalledWith('Clock in to start a ticket timer.');
  });

  it('clocked out: prompts, clocks in, then starts', async () => {
    clock.isClockedIn = false;
    applyMocks();
    const { result } = renderProvider();

    let outcome;
    await act(async () => {
      outcome = await result.current.start(redmineStart);
    });
    expect(outcome).toBe('clock-in');
    expect(mockStart).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Clock In Now' }));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(clock.clockIn).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Timer started on #15 and added to My Board');
  });

  it('plan required: sends the user to plan, then starts and returns once clocked in', async () => {
    clock.isClockedIn = false;
    clock.planMissing = true;
    applyMocks();
    const { result, rerender } = renderProvider();

    await act(async () => {
      await result.current.start(redmineStart);
    });
    expect(
      await screen.findByText(/Your team asks for today's plan before you clock in/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: "Write today's plan" }));
    expect(navigate).toHaveBeenCalledWith('/app/clock');
    expect(result.current.pending?.request).toEqual(redmineStart);
    expect(mockStart).not.toHaveBeenCalled();

    // The user posts the plan and clocks in on the Clock page.
    clock.isClockedIn = true;
    clock.planMissing = false;
    applyMocks();
    rerender();

    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith('/app/tickets'));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
  });

  it('a cancelled pending start does not run on clock-in', async () => {
    clock.isClockedIn = false;
    clock.planMissing = true;
    applyMocks();
    const { result, rerender } = renderProvider();

    await act(async () => {
      await result.current.start(redmineStart);
    });
    fireEvent.click(await screen.findByRole('button', { name: "Write today's plan" }));
    act(() => result.current.cancelPending());

    clock.isClockedIn = true;
    applyMocks();
    rerender();

    expect(result.current.pending).toBeNull();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
