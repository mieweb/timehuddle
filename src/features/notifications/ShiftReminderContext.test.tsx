import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clockApi, notificationApi, type Notification } from '../../lib/api';
import { ShiftReminderProvider } from './ShiftReminderContext';

const team = vi.hoisted(() => ({
  activeClockEvent: { id: 'event-1' } as { id: string } | null,
  clockReady: true,
}));
const live = vi.hoisted(() => ({ push: null as ((n: Notification) => void) | null }));

vi.mock('../../lib/useSession', () => ({ useSession: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../lib/TeamContext', () => ({ useTeam: () => team }));
vi.mock('../../lib/ddp', () => ({
  subscribeNewNotifications: (onNew: (n: Notification) => void) => {
    live.push = onNew;
    return () => {};
  },
}));
vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  clockApi: { getActive: vi.fn() },
  notificationApi: {
    getInbox: vi.fn().mockResolvedValue([]),
    agreeClockout: vi.fn(),
    markOneRead: vi.fn(),
    respondShiftReminder: vi.fn(),
  },
}));
vi.mock('@mieweb/ui', () => {
  const Slot = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
      <button {...props}>{children}</button>
    ),
    ModalBody: Slot,
    ModalClose: () => null,
    ModalFooter: Slot,
    ModalHeader: Slot,
    ModalTitle: Slot,
    Text: Slot,
  };
});
vi.mock('@ui/AppModal', () => ({
  AppModal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

const reminder = {
  id: 'notif-1',
  body: 'You are approaching 8 hours.',
  data: { type: 'shift-end-reminder', clockEventId: 'event-1' },
} as unknown as Notification;

function renderProvider() {
  return render(
    <ShiftReminderProvider>
      <p>page</p>
    </ShiftReminderProvider>,
  );
}

describe('ShiftReminderProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    team.activeClockEvent = { id: 'event-1' };
  });
  afterEach(cleanup);

  it('shows the reminder while its session is still running', () => {
    renderProvider();
    act(() => live.push?.(reminder));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  function endSessionInClockState() {
    team.activeClockEvent = null;
    return screen.queryByRole('dialog');
  }

  it('closes the reminder when the server confirms its session ended', async () => {
    vi.mocked(clockApi.getActive).mockResolvedValue(null);
    const { rerender } = renderProvider();
    act(() => live.push?.(reminder));
    expect(screen.getByRole('dialog')).toBeTruthy();

    endSessionInClockState();
    rerender(
      <ShiftReminderProvider>
        <p>page</p>
      </ShiftReminderProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the reminder when the clock state is only missing because a refresh failed', async () => {
    vi.mocked(clockApi.getActive).mockRejectedValue(new Error('offline'));
    const { rerender } = renderProvider();
    act(() => live.push?.(reminder));

    endSessionInClockState();
    rerender(
      <ShiftReminderProvider>
        <p>page</p>
      </ShiftReminderProvider>,
    );
    await waitFor(() => expect(clockApi.getActive).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('removes the reminder from the inbox list after Continue Working', async () => {
    vi.mocked(notificationApi.respondShiftReminder).mockResolvedValue(undefined as never);
    const handled = vi.fn();
    window.addEventListener('timehuddle:shiftReminderHandled', handled);
    renderProvider();
    act(() => live.push?.(reminder));

    fireEvent.click(screen.getByRole('button', { name: /continue working/i }));
    await waitFor(() => expect(handled).toHaveBeenCalled());
    expect(notificationApi.respondShiftReminder).toHaveBeenCalledWith(
      'notif-1',
      'disagree',
      'event-1',
    );
    expect((handled.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'notif-1' });
    window.removeEventListener('timehuddle:shiftReminderHandled', handled);
  });
});
