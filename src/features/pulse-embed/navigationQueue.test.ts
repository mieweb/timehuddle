import { createFakePulse } from '@mieweb/pulse-embed/testing';
import { describe, expect, it, vi } from 'vitest';

import { closeForSignOut, createNavigationQueue } from './navigationQueue';

const context = { key: 'ticket:abc', kind: 'ticket', id: 'abc', label: 'Fix login' };

describe('createNavigationQueue', () => {
  it('navigates at once while Pulse is closed', () => {
    const navigate = vi.fn();
    const queue = createNavigationQueue();
    expect(queue.request('/app/huddle', navigate)).toBe('now');
    expect(navigate).toHaveBeenCalledWith('/app/huddle');
  });

  it('holds a tap while Pulse is open, says so, and opens it when the flow ends', () => {
    const navigate = vi.fn();
    const onQueued = vi.fn();
    const queue = createNavigationQueue({ onQueued });
    queue.setOpen(true);

    expect(queue.request('/app/huddle?postId=p1', navigate)).toBe('queued');
    expect(navigate).not.toHaveBeenCalled();
    expect(onQueued).toHaveBeenCalledWith('/app/huddle?postId=p1');
    expect(queue.pending()).toBe('/app/huddle?postId=p1');

    expect(queue.flowEnded()).toBe('/app/huddle?postId=p1');
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/app/huddle?postId=p1');
    expect(queue.isOpen()).toBe(false);
    expect(queue.pending()).toBeNull();
  });

  it('opens only the last of several taps', () => {
    const first = vi.fn();
    const last = vi.fn();
    const queue = createNavigationQueue();
    queue.setOpen(true);
    queue.request('/app/notifications', first);
    queue.request('/app/tickets/abc', last);
    queue.flowEnded();
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledExactlyOnceWith('/app/tickets/abc');
  });

  it('does nothing at the end of a flow with nothing held', () => {
    const queue = createNavigationQueue();
    queue.setOpen(true);
    expect(queue.flowEnded()).toBeNull();
  });

  it('drops a held tap when cleared', () => {
    const navigate = vi.fn();
    const queue = createNavigationQueue();
    queue.setOpen(true);
    queue.request('/app/huddle', navigate);
    queue.clear();
    queue.flowEnded();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('closeForSignOut', () => {
  it('closes an open flow with reason "host", keeping the take', async () => {
    const fake = createFakePulse({ flows: [{ result: 'kept', afterMs: 60_000 }] });
    const queue = createNavigationQueue();
    queue.setOpen(true);
    const navigate = vi.fn();
    queue.request('/app/huddle', navigate);

    const result = fake.client.record(context);
    await vi.waitFor(async () => expect(await fake.client.isOpen()).toBe(true));

    expect(await closeForSignOut(fake.client, queue)).toBe(true);
    expect(fake.calls.filter((c) => c.method === 'close').map((c) => c.args)).toEqual([
      { reason: 'host' },
    ]);
    expect(await result).toMatchObject({ reason: 'host' });
    // The tap was for the session that just ended.
    queue.flowEnded();
    expect(navigate).not.toHaveBeenCalled();
    fake.dispose();
  });

  it('does not call close when nothing is open', async () => {
    const fake = createFakePulse();
    expect(await closeForSignOut(fake.client)).toBe(false);
    expect(fake.calls.some((c) => c.method === 'close')).toBe(false);
    fake.dispose();
  });

  it('never rejects, whatever Pulse answers', async () => {
    const client = {
      isOpen: vi.fn().mockRejectedValue(new Error('bridge gone')),
      close: vi.fn(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(closeForSignOut(client)).resolves.toBe(false);
    warn.mockRestore();
  });
});
