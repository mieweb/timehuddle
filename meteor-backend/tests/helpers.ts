/**
 * Test helpers — user creation, JWT acquisition, wormhole call wrapper.
 *
 * Uses Fastify's auth API to create users and obtain JWTs, then calls
 * Meteor wormhole REST endpoints with those JWTs.
 */
import { METEOR_URL, FASTIFY_URL } from './setup';

const AUTH_ORIGIN = process.env.AUTH_ORIGIN ?? 'http://localhost:3000';

// ─── Auth helpers ────────────────────────────────────────────────────────────

export async function signUp(data: { name: string; email: string; password: string }) {
  const res = await fetch(`${FASTIFY_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: AUTH_ORIGIN },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`signUp failed: ${res.status} ${await res.text()}`);
  return res;
}

export async function getSessionToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${FASTIFY_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: AUTH_ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`signIn failed: ${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('signIn returned no token');
  return data.token;
}

export async function getJwt(sessionToken: string): Promise<string> {
  const res = await fetch(`${FASTIFY_URL}/api/auth/token`, {
    headers: { Authorization: `Bearer ${sessionToken}`, Origin: AUTH_ORIGIN },
  });
  if (!res.ok) throw new Error(`getJwt failed: ${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('getJwt returned no token');
  return data.token;
}

export async function createUserAndGetJwt(data: {
  name: string;
  email: string;
  password: string;
}): Promise<{ jwt: string; sessionToken: string }> {
  await signUp(data);
  const sessionToken = await getSessionToken(data.email, data.password);
  const jwt = await getJwt(sessionToken);
  return { jwt, sessionToken };
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
    const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/timehuddle';
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
  const user = await db.collection('user').findOne({ email });
  if (!user) return;
  const userId = String(user._id);
  await Promise.all([
    db.collection('account').deleteMany({ userId }),
    db.collection('session').deleteMany({ userId }),
    db.collection('user').deleteOne({ _id: user._id }),
  ]);
}

export { ObjectId };
