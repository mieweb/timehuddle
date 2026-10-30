import { afterEach, describe, expect, it, vi } from 'vitest';

import { DdpTimeoutError, getDdpClient } from './ddp';

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

describe('method timeouts', () => {
  type Internals = {
    handleMessage(data: Record<string, unknown>): void;
    tryResumeLogin(): Promise<boolean>;
    authPromise: Promise<void> | null;
    ws: unknown;
    connectPromise: Promise<void> | null;
    status: string;
  };
  const client = getDdpClient();
  const internals = client as unknown as Internals;

  function connectFakeSocket() {
    const ws = { send: vi.fn(), close: vi.fn(), onclose: vi.fn() };
    internals.ws = ws;
    internals.status = 'connected';
    internals.connectPromise = Promise.resolve();
    return ws;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem('meteor_resume_token');
    internals.ws = null;
    internals.connectPromise = null;
    internals.status = 'idle';
  });

  it('rejects a call that gets no reply and drops the dead socket', async () => {
    vi.useFakeTimers();
    const ws = connectFakeSocket();

    const call = client.call('slow');
    const rejected = expect(call).rejects.toBeInstanceOf(DdpTimeoutError);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;

    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(ws.onclose).toBeNull();
    expect(internals.ws).toBeNull();
    expect(client.status).toBe('failed');
  });

  it('leaves no timer behind once the server replies', async () => {
    vi.useFakeTimers();
    const ws = connectFakeSocket();

    const call = client.call('fast');
    await vi.advanceTimersByTimeAsync(0);
    const { id } = JSON.parse(ws.send.mock.calls[0][0] as string) as { id: string };
    internals.handleMessage({ msg: 'result', id, result: 'ok' });

    await expect(call).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('keeps the stored login when the resume call times out', async () => {
    localStorage.setItem('meteor_resume_token', 'stored');
    vi.spyOn(client, 'call').mockRejectedValue(new DdpTimeoutError('timed out'));

    await expect(internals.tryResumeLogin()).rejects.toBeInstanceOf(DdpTimeoutError);
    expect(localStorage.getItem('meteor_resume_token')).toBe('stored');
  });

  it('drops the stored login when the server rejects it', async () => {
    localStorage.setItem('meteor_resume_token', 'stale');
    vi.spyOn(client, 'call').mockRejectedValue(new Error('You are not logged in'));

    await expect(internals.tryResumeLogin()).resolves.toBe(false);
    expect(localStorage.getItem('meteor_resume_token')).toBeNull();
  });

  it('rejects the other calls in flight with the timeout, not a lost connection', async () => {
    vi.useFakeTimers();
    connectFakeSocket();

    const first = client.call('first');
    const second = client.call('second');
    const rejected = Promise.all([
      expect(first).rejects.toBeInstanceOf(DdpTimeoutError),
      expect(second).rejects.toBeInstanceOf(DdpTimeoutError),
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
  });

  it('rejects ensureAuthed when the login times out, and lets the next call retry', async () => {
    connectFakeSocket();
    vi.spyOn(internals, 'tryResumeLogin').mockRejectedValue(new DdpTimeoutError('timed out'));

    await expect(client.ensureAuthed()).rejects.toBeInstanceOf(DdpTimeoutError);
    expect(internals.authPromise).toBeNull();
  });

  it('drops a socket that does not answer a liveness ping', async () => {
    vi.useFakeTimers();
    const ws = connectFakeSocket();

    const check = client.verifyConnection();
    await vi.advanceTimersByTimeAsync(5_000);
    await check;

    expect(JSON.parse(ws.send.mock.calls[0][0] as string)).toMatchObject({ msg: 'ping' });
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(internals.ws).toBeNull();
  });

  it('keeps a socket that answers the ping', async () => {
    vi.useFakeTimers();
    const ws = connectFakeSocket();

    const check = client.verifyConnection();
    const { id } = JSON.parse(ws.send.mock.calls[0][0] as string) as { id: string };
    internals.handleMessage({ msg: 'pong', id });
    await check;

    expect(ws.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends one ping for overlapping checks and none without a connection', async () => {
    vi.useFakeTimers();
    await client.verifyConnection();

    const ws = connectFakeSocket();
    const first = client.verifyConnection();
    const second = client.verifyConnection();
    const { id } = JSON.parse(ws.send.mock.calls[0][0] as string) as { id: string };
    internals.handleMessage({ msg: 'pong', id });
    await Promise.all([first, second]);

    expect(ws.send).toHaveBeenCalledTimes(1);
  });
});
