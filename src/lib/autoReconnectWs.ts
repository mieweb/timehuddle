/**
 * autoReconnectWs — thin WebSocket wrapper with automatic exponential-backoff reconnect.
 *
 * Mimics the EventSource interface (.onmessage, .close()) so existing consumers
 * need only a type-level change.
 */

const MAX_DELAY_MS = 30_000;
const BASE_DELAY_MS = 1_000;

export interface AutoReconnectWs {
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
  /** Send a message if the socket is currently open. No-op otherwise. */
  send(data: string): void;
  /** Returns true if the socket is currently connected. */
  readonly connected: boolean;
}

export function autoReconnectWs(buildUrl: () => string): AutoReconnectWs {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const handle: AutoReconnectWs = {
    onmessage: null,
    get connected() {
      return ws?.readyState === WebSocket.OPEN;
    },
    close() {
      closed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      ws?.close();
    },
    send(data: string) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    },
  };

  function connect() {
    if (closed) return;
    ws = new WebSocket(buildUrl());

    ws.onopen = () => {
      attempt = 0;
    };

    ws.onmessage = (event) => {
      handle.onmessage?.(event);
    };

    ws.onclose = (event) => {
      // 4001 = Unauthorized, 4003 = Forbidden — don't retry auth failures
      if (closed || event.code === 4001 || event.code === 4003) return;
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      attempt++;
      retryTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires after onerror — reconnect logic is handled there
    };
  }

  connect();
  return handle;
}
