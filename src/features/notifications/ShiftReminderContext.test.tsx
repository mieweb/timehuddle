import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Notification } from '../../lib/api';
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
    team.activeClockEvent = { id: 'event-1' };
  });
  afterEach(cleanup);

  it('shows the reminder while its session is still running', () => {
    renderProvider();
    act(() => live.push?.(reminder));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes the reminder when its session ends underneath it', () => {
    const { rerender } = renderProvider();
    act(() => live.push?.(reminder));
    expect(screen.getByRole('dialog')).toBeTruthy();

    team.activeClockEvent = null;
    rerender(
      <ShiftReminderProvider>
        <p>page</p>
      </ShiftReminderProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
