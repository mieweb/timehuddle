import { describe, expect, it } from 'vitest';

import type { Notification } from '../../lib/api';
import { applyLiveNotification } from './liveInbox';

const notice = (id: string, type: string, clockEventId?: string) =>
  ({ id, data: { type, clockEventId } }) as unknown as Notification;

describe('applyLiveNotification', () => {
  const reminder = notice('r1', 'shift-end-reminder', 'event-1');
  const otherReminder = notice('r2', 'shift-end-reminder', 'event-2');

  it('drops the session’s reminder when its auto clock-out notice arrives', () => {
    const autoClockOut = notice('a1', 'auto-clock-out', 'event-1');
    expect(applyLiveNotification([reminder, otherReminder], autoClockOut)).toEqual([
      autoClockOut,
      otherReminder,
    ]);
  });

  it('leaves the list alone for other notifications and for ones already shown', () => {
    const ticket = notice('t1', 'ticket-assigned');
    expect(applyLiveNotification([reminder], ticket)).toEqual([ticket, reminder]);
    const inbox = [reminder];
    expect(applyLiveNotification(inbox, reminder)).toBe(inbox);
  });
});
