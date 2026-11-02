import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationApi } from '../../lib/api';
import { NOTIFICATION_READ_EVENT, markTappedNotificationRead } from './notificationEvents';

vi.mock('../../lib/api', () => ({ notificationApi: { markOneRead: vi.fn() } }));

const markOneRead = vi.mocked(notificationApi.markOneRead);

function readEvents() {
  const ids: string[] = [];
  window.addEventListener(NOTIFICATION_READ_EVENT, (e) =>
    ids.push((e as CustomEvent<{ id: string }>).detail.id),
  );
  return ids;
}

describe('markTappedNotificationRead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the row read and tells an open inbox', async () => {
    markOneRead.mockResolvedValue({ ok: true });
    const ids = readEvents();
    markTappedNotificationRead({ notificationId: 'n1', type: 'test' });
    await vi.waitFor(() => expect(ids).toContain('n1'));
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
