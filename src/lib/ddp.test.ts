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
