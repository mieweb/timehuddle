/**
 * PoC auth bridge: resolves a better-auth session token (issued by the Fastify
 * backend) to a userId by reading the shared `session` + `user` collections.
 *
 * Accepted token sources:
 *  - DDP:   client calls `Meteor.call('auth.bridge', token)` once per connection;
 *           subsequent methods/publications read the cached identity.
 *  - REST/MCP: `Authorization: Bearer <token>` header, surfaced by the wormhole
 *           invocation context (`currentBearerToken()`).
 *  - Legacy: explicit `sessionToken` param in the method body (deprecated).
 *
 * Better-auth cookie format is `<token>.<hmac>` — only the part before the first
 * dot is stored in the session collection.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { currentBearerToken } from 'meteor/wreiske:meteor-wormhole';
import { rawDb } from './collections';

// Use Meteor's bundled driver so BSON types match the rawDb() connection.
const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

/** connectionId -> { userId, name } for DDP sessions. */
const connectionIdentity = new Map();

function normalizeToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const token = raw.trim();
  // Cookie values are signed: "<token>.<signature>" — session docs store the bare token.
  const dot = token.indexOf('.');
  return dot > 0 ? token.slice(0, dot) : token;
}

/** Resolve a better-auth session token to { userId, name } or null. */
export async function resolveSessionToken(raw) {
  const token = normalizeToken(raw);
  if (!token) return null;

  const db = rawDb();
  const session = await db.collection('session').findOne({ token });
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null;

  const user = await db.collection('user').findOne({ _id: new ObjectId(String(session.userId)) });
  if (!user) return null;

  return { userId: String(session.userId), name: user.name ?? user.email ?? 'Unknown' };
}

/**
 * Resolve the calling identity inside a method:
 *  1. explicit sessionToken param (legacy REST path), else
 *  2. bearer token from the Authorization header when called through a
 *     Wormhole transport (REST/MCP), else
 *  3. identity cached for this DDP connection via `auth.bridge`.
 * Throws 'not-authorized' when none resolves.
 */
export async function requireIdentity(methodContext, sessionToken) {
  const token = sessionToken || currentBearerToken();
  if (token) {
    const identity = await resolveSessionToken(token);
    if (identity) return identity;
    throw new Meteor.Error('not-authorized', 'Invalid or expired session token');
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
  /** Authenticate this DDP connection with a better-auth session token. */
  async 'auth.bridge'(token) {
    const identity = await resolveSessionToken(token);
    if (!identity) {
      throw new Meteor.Error('not-authorized', 'Invalid or expired session token');
    }
    const conn = this.connection;
    if (conn?.id) {
      connectionIdentity.set(conn.id, identity);
      conn.onClose(() => connectionIdentity.delete(conn.id));
    }
    return { userId: identity.userId, name: identity.name };
  },
});
