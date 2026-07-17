/**
 * Test helpers — user creation, JWT acquisition, wormhole call wrapper.
 *
 * Creates users via DDP (accounts.createUser method), then signs in via
 * DDP to get resume tokens. The resume tokens are used directly as bearer
 * tokens for wormhole REST calls (auth-bridge handles them via resolveToken).
 */
import { METEOR_URL } from './setup';
import crypto from 'crypto';

// ─── DDP Client (minimal, just for auth) ─────────────────────────────────────

interface DDPMessage {
  msg: string;
  id?: string;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: { error: string; reason: string; message: string };
}

class DDPConnection {
  private ws: any;
  private messageId = 0;
  private pending = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
  
  constructor(private url: string) {}
  
  async connect(): Promise<void> {
    const WebSocket = (await import('ws')).default;
    console.log('[DDP] Connecting to:', this.url);
    this.ws = new WebSocket(this.url);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('DDP connection timeout after 10s'));
      }, 10000);
      
      this.ws.on('open', () => {
        console.log('[DDP] WebSocket opened, sending connect message');
        this.ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
      });
      
      this.ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as DDPMessage;
        console.log('[DDP] Received:', msg.msg, msg.id ? `(id: ${msg.id})` : '');
        
        if (msg.msg === 'connected') {
          clearTimeout(timeout);
          console.log('[DDP] Connected successfully');
          resolve();
        } else if (msg.msg === 'result' && msg.id) {
          const handler = this.pending.get(msg.id);
          if (handler) {
            this.pending.delete(msg.id);
            if (msg.error) {
              console.log('[DDP] Method error:', msg.error);
              handler.reject(new Error(msg.error.message || msg.error.reason));
            } else {
              console.log('[DDP] Method success');
              handler.resolve(msg.result);
            }
          }
        }
      });
      
      this.ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        console.log('[DDP] WebSocket error:', err.message);
        reject(err);
      });
    });
  }
  
  call(method: string, params: unknown[] = []): Promise<unknown> {
    const id = String(++this.messageId);
    console.log('[DDP] Calling method:', method, 'with id:', id);
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ msg: 'method', method, params, id }));
      
      // Timeout after 10s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          console.log('[DDP] Method timeout:', method);
          reject(new Error(`DDP call timeout: ${method}`));
        }
      }, 10000);
    });
  }
  
  async login(email: string, password: string): Promise<{ userId: string; token: string }> {
    const sha256 = crypto.createHash('sha256').update(password).digest('hex');
    const result = await this.call('login', [{
      user: { email },
      password: { digest: sha256, algorithm: 'sha-256' }
    }]) as { id: string; token: string };
    
    return { userId: result.id, token: result.token };
  }
  
  close(): void {
    this.ws?.close();
  }
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

/**
 * Create user and get JWT for wormhole REST calls.
 * Uses DDP to create the account (accounts.createUser method).
 */
export async function createUserAndGetJwt(data: {
  name: string;
  email: string;
  password: string;
}): Promise<{ jwt: string; sessionToken: string; userId: string }> {
  console.log('[Test] Creating user:', data.email);
  const ddp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
  
  try {
    console.log('[Test] Connecting to DDP...');
    await ddp.connect();
    
    console.log('[Test] Calling accounts.createUser...');
    // Create user via DDP
    const createResult = await ddp.call('accounts.createUser', [{
      email: data.email,
      password: data.password,
      name: data.name,
    }]) as { userId: string };
    console.log('[Test] User created:', createResult.userId);
    
    console.log('[Test] Logging in...');
    // Login to get resume token
    const loginResult = await ddp.login(data.email, data.password);
    console.log('[Test] Login successful, got token');
    
    // Use the Meteor resume token for wormhole REST calls
    // The auth-bridge's resolveToken() handles resume tokens via resolveMeteorToken()
    return {
      jwt: loginResult.token, // Resume token works as JWT for wormhole calls
      sessionToken: loginResult.token,
      userId: loginResult.userId,
    };
  } catch (err) {
    console.error('[Test] Error during user creation:', err);
    throw err;
  } finally {
    ddp.close();
  }
}

// ─── Wormhole call wrapper ───────────────────────────────────────────────────

export interface WormholeResult<T = unknown> {
  status: number;
  ok: boolean;
  result: T;
  error?: string;
}

export async function wormhole<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  jwt: string,
): Promise<WormholeResult<T>> {
  const route = method.replace(/\./g, '_');
  const res = await fetch(`${METEOR_URL}/api/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as {
    result?: T;
    reason?: string;
    message?: string;
  };
  return {
    status: res.status,
    ok: res.ok,
    result: body.result as T,
    error: body.reason ?? body.message,
  };
}

// ─── DB helpers (direct Mongo for fixture setup/teardown) ────────────────────

import { MongoClient, ObjectId } from 'mongodb';

let _client: MongoClient | null = null;

export async function getDb() {
  if (!_client) {
    // Must match whatever database METEOR_URL's backend instance is using
    // (see setup.ts) — the DDP/REST calls in this file and the direct Mongo
    // access here have to land in the same database or fixtures desync.
    const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/timehuddle_test';
    _client = new MongoClient(uri);
    await _client.connect();
  }
  return _client.db();
}

export async function closeDb() {
  if (_client) {
    await _client.close();
    _client = null;
  }
}

export async function purgeUser(email: string) {
  const db = await getDb();
  // Find user in Meteor users collection (email is in emails.address)
  const user = await db.collection('users').findOne({ 'emails.address': email });
  if (!user) return;
  
  const userId = String(user._id);
  await Promise.all([
    db.collection('users').deleteOne({ _id: user._id }),
    db.collection('org_members').deleteMany({ userId }),
    db.collection('clockevents').deleteMany({ userId }),
  ]);
}

export { ObjectId };
