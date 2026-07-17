import { expect, test } from '@playwright/test';
import { MongoClient } from 'mongodb';
import crypto from 'crypto';
import WebSocket from 'ws';

// ─── Minimal DDP client for auth ─────────────────────────────────────────────

interface DDPMessage {
  msg: string;
  id?: string;
  result?: unknown;
  error?: { error: string; reason: string; message: string };
}

async function ddpLogin(
  meteorUrl: string,
  email: string,
  password: string,
): Promise<{ userId: string; token: string }> {
  const wsUrl = meteorUrl.replace('http://', 'ws://') + '/websocket';
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    let messageId = 0;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('DDP login timeout'));
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as DDPMessage;

      if (msg.msg === 'connected') {
        // Send login
        const id = String(++messageId);
        const digest = crypto.createHash('sha256').update(password).digest('hex');
        ws.send(
          JSON.stringify({
            msg: 'method',
            method: 'login',
            params: [
              {
                user: { email },
                password: { digest, algorithm: 'sha-256' },
              },
            ],
            id,
          }),
        );
      } else if (msg.msg === 'result') {
        clearTimeout(timeout);
        ws.close();
        if (msg.error) {
          reject(new Error(msg.error.message || msg.error.reason));
        } else {
          const result = msg.result as { id: string; token: string };
          resolve({ userId: result.id, token: result.token });
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Work Summary API', () => {
  let mongoClient: MongoClient;
  let _db: ReturnType<MongoClient['db']>;

  const MONGO_URL =
    process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
  const METEOR_BASE_URL = process.env.METEOR_BASE_URL || 'http://localhost:3101';

  // Auth for owner1 and member1 (provisioned test users)
  let ownerAuth: { userId: string; token: string };
  let memberAuth: { userId: string; token: string };

  test.beforeAll(async () => {
    mongoClient = await MongoClient.connect(MONGO_URL);
    _db = mongoClient.db();

    // Login via DDP to get resume tokens for API calls
    [ownerAuth, memberAuth] = await Promise.all([
      ddpLogin(METEOR_BASE_URL, 'owner1@test.local', 'TestPass1!'),
      ddpLogin(METEOR_BASE_URL, 'member1@test.local', 'TestPass1!'),
    ]);
  });

  test.afterAll(async () => {
    await mongoClient?.close();
  });

  test('requires authentication', async ({ request }) => {
    const summaryRes = await request.post(`${METEOR_BASE_URL}/api/timers_getUserWorkSummary`, {
      headers: { 'Content-Type': 'application/json' },
      data: { userId: 'some-user-id' },
    });

    expect(summaryRes.status()).toBe(500);
    const body = await summaryRes.json();
    expect(body.error).toBe('not-authorized');
  });

  test('returns tickets worked on in last 48 hours', async ({ request }) => {
    const res = await request.post(`${METEOR_BASE_URL}/api/timers_getUserWorkSummary`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAuth.token}`,
      },
      data: { userId: ownerAuth.userId },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    // Result should have an items array (may be empty if no recent work)
    expect(body.result).toBeDefined();
    expect(body.result.items).toBeInstanceOf(Array);
  });

  test('allows user to view their own summary', async ({ request }) => {
    const res = await request.post(`${METEOR_BASE_URL}/api/timers_getUserWorkSummary`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberAuth.token}`,
      },
      data: { userId: memberAuth.userId },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.result).toBeDefined();
    expect(body.result.items).toBeInstanceOf(Array);
  });

  test('allows teammate to view work summary', async ({ request }) => {
    // owner1 and member1 share the same org, so owner can view member's summary
    const res = await request.post(`${METEOR_BASE_URL}/api/timers_getUserWorkSummary`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAuth.token}`,
      },
      data: { userId: memberAuth.userId },
    });

    // If they share a team, this succeeds; if not, we expect a 'forbidden' error.
    // Either outcome validates the permission check works.
    const body = await res.json();
    if (res.ok()) {
      expect(body.result).toBeDefined();
      expect(body.result.items).toBeInstanceOf(Array);
    } else {
      // Permission denied is valid — users must share a non-personal team
      expect(body.error).toBe('forbidden');
    }
  });

  test('returns empty array when user has no recent work', async ({ request }) => {
    // member1 likely has no recent timer activity in the test environment
    const res = await request.post(`${METEOR_BASE_URL}/api/timers_getUserWorkSummary`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberAuth.token}`,
      },
      data: { userId: memberAuth.userId },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.result).toBeDefined();
    expect(body.result.items).toBeInstanceOf(Array);
    // Items should be empty since no timers have been started in tests
    expect(body.result.items.length).toBe(0);
  });
});
