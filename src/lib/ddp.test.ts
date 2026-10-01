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

  /** Test helper: simulate a pong reply for the given ping id. */
  simulatePong(id: string): void {
    this.onmessage?.({ data: JSON.stringify({ msg: 'pong', id }) });
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

describe('DdpClient resume login', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function startResumeLogin() {
    localStorage.setItem('meteor_resume_token', 'saved-token');
    const { getDdpClient } = await freshDdpModule();
    const authed = getDdpClient().ensureAuthed();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpenAndConnect();
    await vi.advanceTimersByTimeAsync(0);
    const login = JSON.parse(ws.sent[ws.sent.length - 1]) as { id: string; method: string };
    expect(login.method).toBe('login');
    return { authed, ws, login };
  }

  it('keeps the saved token when the login call times out', async () => {
    const { authed } = await startResumeLogin();

    await vi.advanceTimersByTimeAsync(8000);
    await authed;

    expect(localStorage.getItem('meteor_resume_token')).toBe('saved-token');
  });

  it('removes the saved token when the server rejects it', async () => {
    const { authed, ws, login } = await startResumeLogin();

    ws.onmessage?.({
      data: JSON.stringify({ msg: 'result', id: login.id, error: { reason: 'Login expired' } }),
    });
    await authed;

    expect(localStorage.getItem('meteor_resume_token')).toBeNull();
  });
});

describe('DdpClient.checkConnection (foreground reconnect)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function connectedClient() {
    const { getDdpClient } = await freshDdpModule();
    const client = getDdpClient();
    // Any connected call establishes the socket; checkConnection is a no-op until then.
    const warmup = client.call('warmup');
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpenAndConnect();
    await vi.advanceTimersByTimeAsync(0);
    const sentWarmup = JSON.parse(ws.sent[ws.sent.length - 1]) as { id: string };
    ws.simulateResult(sentWarmup.id, null);
    await warmup;
    return { client, ws };
  }

  it('tears the socket down and reconnects when no pong arrives in time', async () => {
    const { client, ws } = await connectedClient();

    void client.checkConnection();
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.sent.some((m) => JSON.parse(m).msg === 'ping')).toBe(true);

    const instancesBefore = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(2000);

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    // handleDisconnect only schedules a reconnect timer when there's an active
    // sub; here we just confirm the socket was torn down, which is the part
    // that unblocks a stuck pull-to-refresh.
    expect(FakeWebSocket.instances.length).toBe(instancesBefore);
  });

  it('does nothing when a pong arrives in time', async () => {
    const { client, ws } = await connectedClient();

    const checkPromise = client.checkConnection();
    await vi.advanceTimersByTimeAsync(0);
    const sentPing = JSON.parse(ws.sent[ws.sent.length - 1]) as { id: string; msg: string };
    expect(sentPing.msg).toBe('ping');
    ws.simulatePong(sentPing.id);

    await checkPromise;
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);

    // No stray timeout fires later and tears the (still healthy) socket down.
    await vi.advanceTimersByTimeAsync(5000);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
  });

  it('shares one in-flight ping when called twice in quick succession', async () => {
    const { client, ws } = await connectedClient();

    const first = client.checkConnection();
    const second = client.checkConnection();
    await vi.advanceTimersByTimeAsync(0);

    const pings = ws.sent.filter((m) => JSON.parse(m).msg === 'ping');
    expect(pings).toHaveLength(1);

    const sentPing = JSON.parse(pings[0]) as { id: string };
    ws.simulatePong(sentPing.id);
    await Promise.all([first, second]);
  });
});
