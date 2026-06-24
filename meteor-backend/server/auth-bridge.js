/**
 * Auth bridge: resolves caller credentials issued by the better-auth IdP
 * (Fastify backend) using Meteor's built-in Accounts system.
 *
 * Accepted token formats:
 *  - JWT access token (better-auth `jwt` plugin, 15-min TTL) — verified
 *    statelessly against the IdP's JWKS (`AUTH_JWKS_URL`).
 *  - Personal access token (`th_pat_…`) — sha256 lookup in the shared
 *    `personal_access_tokens` collection (parity with Fastify).
 *
 * Token sources:
 *  - DDP:   client calls Meteor login handlers via DDP login protocol
 *  - HTTP:  `Authorization: Bearer <token>` header (handled by uploads.js)
 */
import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { MongoInternals } from 'meteor/mongo';
import { createHash } from 'crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { currentBearerToken } from 'meteor/wreiske:meteor-wormhole';
import { rawDb } from './collections';

// Use Meteor's bundled driver so BSON types match the rawDb() connection.
const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const PAT_PREFIX = 'th_pat_';

// JWKS published by the better-auth backend. jose caches keys and handles
// `kid` rotation with a cooldown — verification itself is local.
const JWKS_URL = process.env.AUTH_JWKS_URL || 'http://localhost:4000/api/auth/jwks';
let jwks = null;

/** A JWT has exactly three dot-separated segments. */
function looksLikeJwt(token) {
  return token.split('.').length === 3;
}

async function resolveJwt(token) {
  try {
    jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
    const { payload } = await jwtVerify(token, jwks);
    if (!payload.sub) return null;
    return { 
      userId: payload.sub, 
      name: payload.name || payload.email || 'Unknown',
      email: payload.email 
    };
  } catch (err) {
    console.error('[auth-bridge] JWT verification failed:', err.message || err);
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
 * Find or create a Meteor user account by email.
 * Used by login handlers to ensure a user exists before returning userId.
 */
export async function findOrCreateUser(email, name) {
  const db = rawDb()
  const normalizedEmail = email.toLowerCase().trim()

  // Step 1: Check if Meteor user already exists
  const existingMeteorUser = Accounts.findUserByEmail(normalizedEmail)
  if (existingMeteorUser?._id) {
    console.log('[auth-bridge] found existing Meteor user:', 
      existingMeteorUser._id)
    return existingMeteorUser._id
  }

  // Step 2: Check if Fastify user exists in 'user' collection
  const fastifyUser = await db.collection('user')
    .findOne({ email: normalizedEmail })
  
  if (fastifyUser) {
    console.log('[auth-bridge] found Fastify user:', 
      fastifyUser._id.toHexString())
    
    // Create Meteor user with SAME _id as Fastify user
    try {
      await Meteor.users.insertAsync({
        _id: fastifyUser._id.toHexString(),
        emails: [{ 
          address: normalizedEmail, 
          verified: true 
        }],
        profile: { 
          name: name || fastifyUser.name || normalizedEmail 
        },
        createdAt: fastifyUser.createdAt || new Date()
      })
      console.log('[auth-bridge] created Meteor user with Fastify _id:', 
        fastifyUser._id.toHexString())
      return fastifyUser._id.toHexString()
    } catch (err) {
      console.error('[auth-bridge] Meteor.users.insert error:', err.message)
      // Maybe created by concurrent request - retry lookup
      const retryUser = Accounts.findUserByEmail(normalizedEmail)
      if (retryUser?._id) return retryUser._id
      // Last resort - return the fastify user id directly
      return fastifyUser._id.toHexString()
    }
  }

  // Step 3: Brand new user - create in Meteor Accounts
  console.log('[auth-bridge] creating brand new Meteor user:', normalizedEmail)
  try {
    const userId = Accounts.createUser({
      email: normalizedEmail,
      profile: { name: name || normalizedEmail }
    })
    console.log('[auth-bridge] created new user:', userId)
    
    // Also create in Fastify user collection
    await db.collection('user').insertOne({
      _id: new ObjectId(userId),  // same _id!
      email: normalizedEmail,
      name: name || normalizedEmail,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    console.log('[auth-bridge] synced user to Fastify collection:', userId)
    
    return userId
  } catch (err) {
    console.error('[auth-bridge] Accounts.createUser error:', err.message)
    throw err
  }
}

export async function requireIdentity(methodContext) {
  // Path 1: REST/MCP via wormhole
  // reads Authorization: Bearer header
  const token = currentBearerToken()
  if (token) {
    const identity = await resolveToken(token)
    if (identity) return identity
    throw new Meteor.Error('not-authorized', 'Invalid or expired token')
  }

  // Path 2: DDP via Meteor Accounts
  // this.userId set after login({ oidcJwt })
  const userId = methodContext?.userId
  if (userId) {
    const user = await Meteor.users.findOneAsync(userId)
    return {
      userId,
      name: user?.profile?.name || user?.emails?.[0]?.address || 'Unknown'
    }
  }

  throw new Meteor.Error('not-authorized', 'Not logged in')
}

export function identityForConnection(connection) {
  const userId = connection?.userId
  if (userId) {
    const user = Meteor.users.findOne(userId)
    return {
      userId,
      name: user?.profile?.name || user?.emails?.[0]?.address || 'Unknown'
    }
  }
  return null
}

// ============================================================================
// Meteor Accounts Login Handlers
// ============================================================================

// Register login handler for OIDC JWT tokens (GitHub/Google/Apple via Fastify)
Accounts.registerLoginHandler('oidc', async (options) => {
  console.log('[auth-bridge] oidc handler called with options:', JSON.stringify(options));
  if (!options.oidcJwt) return undefined;

  const claims = await resolveJwt(options.oidcJwt);
  if (!claims) return undefined;

  const userId = await findOrCreateUser(claims.email || claims.userId, claims.name);

  return { userId };
});

// Register login handler for Personal Access Tokens
Accounts.registerLoginHandler('pat', async (options) => {
  console.log('[auth-bridge] pat handler called with options:', JSON.stringify(options));
  if (!options.patToken) return undefined;

  const identity = await resolvePat(options.patToken);
  if (!identity) return undefined;

  return { userId: identity.userId };
});

// ============================================================================
// Proxy JWT Support (Authentik)
// ============================================================================

// Get proxy secret as Uint8Array
function getProxySecret() {
  const secret = process.env.PROXY_JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

// Verify a proxy JWT
async function verifyProxyJwt(token) {
  const secret = getProxySecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.proxy || !payload.email) return null;
    return { email: payload.email, name: payload.name };
  } catch {
    return null;
  }
}

// Sign a short-lived proxy JWT (called by /auth/whoami endpoint)
export async function signProxyJwt(email, name) {
  const secret = getProxySecret();
  if (!secret) throw new Error('PROXY_JWT_SECRET not set');
  return new SignJWT({ email, name, proxy: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(secret);
}

// Register login handler for Authentik proxy JWT
Accounts.registerLoginHandler('proxy', async (options) => {
  console.log('[auth-bridge] proxy handler called with options:', JSON.stringify(options));
  if (!options.proxyJwt) return undefined;
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return undefined;

  const claims = await verifyProxyJwt(options.proxyJwt);
  if (!claims) return undefined;

  const userId = await findOrCreateUser(claims.email, claims.name);
  return { userId };
});

// ============================================================================
// Meteor Methods
// ============================================================================

Meteor.methods({
  'accounts.createUser': async function({ email, password, name }) {
    // Create user via Meteor Accounts with password
    const userId = await findOrCreateUser(email, name);
    
    // Set password for the user
    Accounts.setPassword(userId, password, { logout: false });
    
    console.log('[auth-bridge] Created user via accounts.createUser:', userId);
    return { userId };
  },

  'auth.loginWithPassword': async function({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Find user by email
    const user = Accounts.findUserByEmail(normalizedEmail);
    if (!user) {
      throw new Meteor.Error('user-not-found', 'User not found');
    }
    
    // Check password using Accounts._checkPassword
    const result = Accounts._checkPassword(user, {
      digest: password.digest,
      algorithm: password.algorithm
    });
    
    if (result.error) {
      throw new Meteor.Error('incorrect-password', 'Incorrect password');
    }
    
    // Generate and return a resume token
    const stampedToken = Accounts._generateStampedLoginToken();
    await Accounts._insertLoginToken(user._id, stampedToken);
    
    return {
      id: user._id,
      token: stampedToken.token,
      tokenExpires: stampedToken.when
    };
  },

  'users.getCurrentUser': async function() {
    if (!this.userId) return null;
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) return null;
    return {
      id: this.userId,
      email: user.emails?.[0]?.address || '',
      name: user.profile?.name || user.emails?.[0]?.address || 'Unknown'
    };
  }
});

// ============================================================================
// GitHub OAuth User Sync
// ============================================================================

// Sync GitHub OAuth users to Fastify user collection
Accounts.onLogin(async (info) => {
  try {
    const user = info.user;
    if (!user?.services?.github) return;
    
    const email =
      user.services.github.email || user.emails?.[0]?.address;
    if (!email) return;
    
    const name =
      user.services.github.name ||
      user.services.github.login ||
      email;
    
    const db = rawDb();
    await db.collection('user').updateOne(
      { email: email.toLowerCase() },
      {
        $set: {
          updatedAt: new Date(),
          name: name,
        },
        $setOnInsert: {
          email: email.toLowerCase(),
          emailVerified: true,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(
      '[auth-bridge] synced GitHub user to Fastify collection:',
      email
    );
  } catch (err) {
    console.error(
      '[auth-bridge] GitHub sync error:',
      err.message
    );
  }
  
  // Sync Google OAuth users to Fastify user collection
  try {
    if (user?.services?.google) {
      const email = user.services.google.email ||
                    user.emails?.[0]?.address
      if (email) {
        const name = user.services.google.name || email
        await db.collection('user').updateOne(
          { email: email.toLowerCase() },
          {
            $set: { updatedAt: new Date(), name },
            $setOnInsert: {
              email: email.toLowerCase(),
              emailVerified: true,
              createdAt: new Date()
            }
          },
          { upsert: true }
        )
        console.log(
          '[auth-bridge] synced Google user to Fastify collection:',
          email
        );
      }
    }
  } catch (err) {
    console.error(
      '[auth-bridge] Google sync error:',
      err.message
    );
  }
});
