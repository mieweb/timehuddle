import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDdpClient } from './ddp';

describe('getCurrentUser without a stored session', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves null without waiting for the socket, and still opens it for sign-in', async () => {
    localStorage.removeItem('meteor_resume_token');
    const sockets: unknown[] = [];
    // A socket that never connects: if getCurrentUser awaited it, this would hang.
    vi.stubGlobal(
      'WebSocket',
      class {
        static CONNECTING = 0;
        static OPEN = 1;
        readyState = 0;
        constructor() {
          sockets.push(this);
        }
        send() {}
        close() {}
      },
    );

    await expect(getDdpClient().getCurrentUser()).resolves.toBeNull();
    expect(sockets).toHaveLength(1);
  });
});

describe('collection change notifications', () => {
  type Internals = {
    handleMessage(data: Record<string, unknown>): void;
    ensureAuthed(): Promise<void>;
    ws: { send(raw: string): void } | null;
  };
  const client = getDdpClient();
  const internals = client as unknown as Internals;
  const added = (collection: string, id: string) =>
    internals.handleMessage({ msg: 'added', collection, id, fields: { n: id } });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('notifies once per frame for a burst of updates to one collection', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const off = client.onCollectionChange('burst', listener);
    for (let i = 0; i < 50; i++) added('burst', `doc${i}`);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(client.docs('burst')).toHaveLength(50);
    off();
  });

  it('notifies each changed collection, not only the first', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = client.onCollectionChange('first', first);
    const offSecond = client.onCollectionChange('second', second);
    added('first', 'a');
    added('second', 'b');
    vi.advanceTimersByTime(16);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });

  it("flushes pending notifications before a subscription's ready callback", async () => {
    vi.useFakeTimers();
    const sent: Array<{ msg: string; id: string }> = [];
    vi.spyOn(internals, 'ensureAuthed').mockResolvedValue();
    internals.ws = { send: (raw) => sent.push(JSON.parse(raw)) };

    const order: string[] = [];
    const off = client.onCollectionChange('ready-order', () => order.push('change'));
    const unsubscribe = client.subscribe('ready-order.pub', [], () => order.push('ready'));
    await vi.waitFor(() => expect(sent.some((m) => m.msg === 'sub')).toBe(true));
    const subId = sent.find((m) => m.msg === 'sub')!.id;

    added('ready-order', 'a');
    internals.handleMessage({ msg: 'ready', subs: [subId] });
    expect(order).toEqual(['change', 'ready']);

    vi.advanceTimersByTime(16);
    expect(order).toEqual(['change', 'ready']);
    off();
    unsubscribe();
    internals.ws = null;
  });
});
