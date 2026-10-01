import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal fake WebSocket — enough surface for DdpClient's connect/call flow. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  /** Test helper: simulate the server accepting the DDP handshake. */
  simulateOpenAndConnect(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ msg: 'connected' }) });
  }

  /** Test helper: simulate a method reply for the given method id. */
  simulateResult(id: string, result: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ msg: 'result', id, result }) });
  }
}

/** Fresh module registry per test so the DdpClient singleton doesn't leak across tests. */
async function freshDdpModule() {
  vi.resetModules();
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  return import('./ddp');
}

describe('DdpClient.call timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects after the method timeout when no result ever arrives, and tears down the socket', async () => {
    const { getDdpClient } = await freshDdpModule();
    const client = getDdpClient();

    const callPromise = client.call('some.method');
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpenAndConnect();
    await vi.advanceTimersByTimeAsync(0);

    let settled = false;
    callPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await expect(callPromise).rejects.toThrow(/timed out/);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('resolves normally when a result arrives before the timeout, and clears the pending timer', async () => {
    const { getDdpClient } = await freshDdpModule();
    const client = getDdpClient();

    const callPromise = client.call('some.method');
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpenAndConnect();
    await vi.advanceTimersByTimeAsync(0);

    const sentMethod = JSON.parse(ws.sent[ws.sent.length - 1]) as { id: string };
    ws.simulateResult(sentMethod.id, { ok: true });

    await expect(callPromise).resolves.toEqual({ ok: true });

    // Advancing well past the timeout must not throw — the timer was cleared.
    await vi.advanceTimersByTimeAsync(20_000);
  });

  it('propagates a timeout to other pending calls via handleDisconnect, and schedules a reconnect', async () => {
    const { getDdpClient } = await freshDdpModule();
    const client = getDdpClient();

    // An active subscription is required for handleDisconnect to schedule a reconnect.
    client.subscribe('some.publication', []);
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpenAndConnect();
    await vi.advanceTimersByTimeAsync(0);

    const callA = client.call('method.a');
    await vi.advanceTimersByTimeAsync(0);
    const callB = client.call('method.b');
    await vi.advanceTimersByTimeAsync(0);

    callA.catch(() => {});
    callB.catch(() => {});

    await vi.advanceTimersByTimeAsync(8000);

    await expect(callA).rejects.toThrow(/timed out/);
    await expect(callB).rejects.toThrow(/connection lost/);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);

    // Reconnect is scheduled with backoff starting at 1000ms.
    const instancesBefore = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(instancesBefore);
  });
});
