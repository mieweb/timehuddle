import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationApi } from '../../lib/api';
import { NOTIFICATION_READ_EVENT, markTappedNotificationRead } from './notificationEvents';

vi.mock('../../lib/api', () => ({ notificationApi: { markOneRead: vi.fn() } }));

const markOneRead = vi.mocked(notificationApi.markOneRead);

function readEvents() {
  const details: { id: string; readAt: string }[] = [];
  window.addEventListener(NOTIFICATION_READ_EVENT, (e) =>
    details.push((e as CustomEvent<{ id: string; readAt: string }>).detail),
  );
  return details;
}

describe('markTappedNotificationRead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the row read and tells an open inbox the time the server saved', async () => {
    const readAt = '2026-11-02T15:20:00.000Z';
    markOneRead.mockResolvedValue({ ok: true, readAt });
    const details = readEvents();
    markTappedNotificationRead({ notificationId: 'n1', type: 'test' });
    await vi.waitFor(() => expect(details).toContainEqual({ id: 'n1', readAt }));
    expect(markOneRead).toHaveBeenCalledWith('n1');
  });

  it('leaves a shift-end reminder unread for its prompt', () => {
    markTappedNotificationRead({ notificationId: 'n2', type: 'shift-end-reminder' });
    expect(markOneRead).not.toHaveBeenCalled();
  });

  it('does nothing without an id', () => {
    markTappedNotificationRead({ type: 'test' });
    expect(markOneRead).not.toHaveBeenCalled();
  });
});
