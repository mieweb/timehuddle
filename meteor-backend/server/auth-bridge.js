/**
 * Auth bridge: resolves caller credentials issued by the better-auth IdP
 * (Fastify backend) WITHOUT reading the session collection.
 *
 * Accepted token formats:
 *  - JWT access token (better-auth `jwt` plugin, 15-min TTL) — verified
 *    statelessly against the IdP's JWKS (`AUTH_JWKS_URL`).
 *  - Personal access token (`th_pat_…`) — sha256 lookup in the shared
 *    `personal_access_tokens` collection (parity with Fastify).
 *
 * Token sources:
 *  - DDP:   client calls `Meteor.call('auth.bridge', token)` once per
 *           connection (and again before the JWT expires); subsequent
 *           methods/publications read the cached identity.
 *  - REST/MCP: `Authorization: Bearer <token>` header, surfaced by the
 *           wormhole invocation context (`currentBearerToken()`).
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { currentBearerToken } from 'meteor/wreiske:meteor-wormhole';
import { createHash } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { rawDb } from './collections';

// Use Meteor's bundled driver so BSON types match the rawDb() connection.
const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const PAT_PREFIX = 'th_pat_';

// JWKS published by the better-auth backend. jose caches keys and handles
// `kid` rotation with a cooldown — verification itself is local.
const JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:4000/api/auth/jwks';
let jwks = null;

/** connectionId -> { userId, name } for DDP sessions. */
const connectionIdentity = new Map();

/** A JWT has exactly three dot-separated segments. */
function looksLikeJwt(token) {
  return token.split('.').length === 3;
}

async function resolveJwt(token) {
  try {
    jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
    const { payload } = await jwtVerify(token, jwks);
    if (!payload.sub) return null;
    return { userId: payload.sub, name: payload.name || payload.email || 'Unknown' };
  } catch {
    return null;
  }
}

async function resolvePat(token) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const db = rawDb();
  const pat = await db
    .collection('personal_access_tokens')
    .findOneAndUpdate({ tokenHash }, { $set: { lastUsedAt: new Date() } });
  if (!pat?.userId) return null;
  const user = await db.collection('user').findOne({ _id: new ObjectId(String(pat.userId)) });
  return { userId: String(pat.userId), name: user?.name ?? user?.email ?? 'Unknown' };
}

/** Resolve a bearer token (JWT or PAT) to { userId, name } or null. */
export async function resolveToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const token = raw.trim();
  if (token.startsWith(PAT_PREFIX)) return resolvePat(token);
  if (looksLikeJwt(token)) return resolveJwt(token);
  return null;
}

/**
 * Resolve the calling identity inside a method:
 *  1. bearer token from the Authorization header when called through a
 *     Wormhole transport (REST/MCP), else
 *  2. identity cached for this DDP connection via `auth.bridge`.
 * Throws 'not-authorized' when neither resolves.
 */
export async function requireIdentity(methodContext) {
  const token = currentBearerToken();
  if (token) {
    const identity = await resolveToken(token);
    if (identity) return identity;
    throw new Meteor.Error('not-authorized', 'Invalid or expired token');
  }
  const connId = methodContext?.connection?.id;
  const cached = connId ? connectionIdentity.get(connId) : null;
  if (cached) return cached;
  throw new Meteor.Error(
    'not-authorized',
    'Provide an Authorization: Bearer header or call auth.bridge first',
  );
}

/** Identity for publications (DDP only — must have called auth.bridge). */
export function identityForConnection(connection) {
  return connection?.id ? (connectionIdentity.get(connection.id) ?? null) : null;
}

Meteor.methods({
  /** Authenticate this DDP connection with a JWT or PAT. Re-call before exp. */
  async 'auth.bridge'(token) {
    const identity = await resolveToken(token);
    if (!identity) {
      throw new Meteor.Error('not-authorized', 'Invalid or expired token');
    }
    const conn = this.connection;
    if (conn?.id) {
      connectionIdentity.set(conn.id, identity);
      conn.onClose(() => connectionIdentity.delete(conn.id));
    }
    return { userId: identity.userId, name: identity.name };
  },
});
