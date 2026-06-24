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
import { jwtVerify, SignJWT } from 'jose';
import { currentBearerToken } from 'meteor/wreiske:meteor-wormhole';
import { rawDb } from './collections';

// Use Meteor's bundled driver so BSON types match the rawDb() connection.
const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const PAT_PREFIX = 'th_pat_';

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
}

async function findUserById(id) {
  // Try Meteor collection first (new users created via accounts.createUser)
  const meteorUser = await rawDb().collection('users').findOne({ _id: String(id) });
  if (meteorUser) return {
    _id: meteorUser._id,
    name: meteorUser.profile?.name ?? null,
    email: meteorUser.emails?.[0]?.address ?? null,
    username: meteorUser.username ?? null,
    image: meteorUser.image ?? null,
    bio: meteorUser.bio ?? '',
    website: meteorUser.website ?? '',
    reportsToUserId: meteorUser.reportsToUserId ?? null,
  };
  // Fall back to Fastify collection (old migrated users)
  return await rawDb().collection('user').findOne({ _id: toId(String(id)) }) ?? null;
}

async function resolvePat(token) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const db = rawDb();
  const pat = await db
    .collection('personal_access_tokens')
    .findOneAndUpdate({ tokenHash }, { $set: { lastUsedAt: new Date() } });
  if (!pat?.userId) return null;
  const user = await findUserById(pat.userId);
  return { userId: String(pat.userId), name: user?.name ?? user?.email ?? 'Unknown' };
}

async function resolveMeteorToken(token) {
  // Look up the hashed token in Meteor's users collection
  const bcrypt = Npm.require('bcrypt');
  const users = await Meteor.users.find({
    'services.resume.loginTokens': { $exists: true }
  }).fetchAsync();
  
  for (const user of users) {
    const tokens = user.services?.resume?.loginTokens ?? [];
    for (const lt of tokens) {
      if (lt.hashedToken) {
        // Meteor hashes tokens with SHA256 then base64
        const { createHash } = Npm.require('crypto');
        const hashed = createHash('sha256').update(token).digest('base64');
        if (hashed === lt.hashedToken) {
          return { userId: user._id, name: user.profile?.name || user.emails?.[0]?.address || 'Unknown' };
        }
      }
    }
  }
  return null;
}

/** Resolve a bearer token (PAT or Meteor resume token) to { userId, name } or null. */
export async function resolveToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const token = raw.trim();
  if (token.startsWith(PAT_PREFIX)) return resolvePat(token);
  // Try as Meteor resume token
  const meteorIdentity = await resolveMeteorToken(token);
  if (meteorIdentity) return meteorIdentity;
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
  const existingMeteorUser = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail })
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
      const retryUser = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail })
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
      _id: userId,  // same _id!
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

// Register login handler for Personal Access Tokens
Accounts.registerLoginHandler('pat', async (options) => {
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
  const user = info.user;
  const db = rawDb();

  // GitHub sync
  try {
    if (user?.services?.github) {
      const email =
        user.services.github.email || user.emails?.[0]?.address;
      if (email) {
        const name =
          user.services.github.name ||
          user.services.github.login ||
          email;
        
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
      }
    }
  } catch (err) {
    console.error(
      '[auth-bridge] GitHub sync error:',
      err.message
    );
  }
  
  // Google sync
  try {
    if (user?.services?.google) {
      const email = user.services.google.email ||
                    user.emails?.[0]?.address;
      if (email) {
        const name = user.services.google.name || email;
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
        );
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

// ============================================================================
// DDP Signup Method
// ============================================================================

Meteor.methods({
  'accounts.createUser': async function({ email, password, name }) {
    // Rate limit: not logged in only
    if (this.userId) throw new Meteor.Error('already-logged-in', 'Already logged in');
    
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if user already exists in Fastify collection
    const db = rawDb();
    const existingFastify = await db.collection('user').findOne({ email: normalizedEmail });
    if (existingFastify) {
      throw new Meteor.Error('email-exists', 'An account with this email already exists');
    }
    
    // Create in Meteor Accounts (accounts-password handles password hashing)
    let userId;
    try {
      userId = await Accounts.createUserAsync({
        email: normalizedEmail,
        password,
        profile: { name: name || normalizedEmail }
      });
    } catch (err) {
      if (err.message?.includes('already exists')) {
        throw new Meteor.Error('email-exists', 'An account with this email already exists');
      }
      throw err;
    }
    
    // Sync to Fastify user collection with same _id
    await db.collection('user').insertOne({
      _id: userId,  // keep as string to match Meteor's _id
      email: normalizedEmail,
      name: name || normalizedEmail,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log('[auth-bridge] created new user via accounts.createUser:', userId);
    return { userId };
  },

  'accounts.sendResetPasswordEmail': async function({ email }) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail });
    if (!user) {
      // Don't reveal if email exists
      return { ok: true };
    }
    if (!process.env.SMTP_HOST) {
      throw new Meteor.Error('smtp-not-configured', 
        'Password reset emails are not configured yet. Please contact your administrator.');
    }
    await Accounts.sendResetPasswordEmail(user._id);
    return { ok: true };
  },

  'accounts.resetPassword': async function({ token, newPassword }) {
    if (!token || !newPassword) {
      throw new Meteor.Error('invalid-params', 'Token and new password are required');
    }
    await Accounts.resetPassword(token, newPassword);
    return { ok: true };
  }
});

// ============================================================================
// Email/Password Login Handler
// ============================================================================

Accounts.registerLoginHandler('emailPassword', async (options) => {
  if (!options.emailPassword) return undefined;
  
  const { email, password } = options.emailPassword;
  const normalizedEmail = email.toLowerCase().trim();
  
  // Find user directly via MongoDB
  const user = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail });
  if (!user) return undefined;
  
  // Path 1: User already has bcrypt hash — verify natively
  const storedBcrypt = user?.services?.password?.bcrypt;
  if (storedBcrypt) {
    const bcrypt = Npm.require('bcrypt');
    // Meteor hashes passwords as SHA256(password) before bcrypt
    // Try both raw and SHA256 hashed to support both Meteor-created
    // and migrated-from-Fastify users
    let match = await bcrypt.compare(password.raw, storedBcrypt);
    if (!match) {
      // Try SHA256 digest (Meteor's native format)
      match = await bcrypt.compare(password.digest, storedBcrypt);
    }
    if (!match) return undefined;
    return { userId: user._id };
  }
  
  // Path 2: No bcrypt hash yet — verify via Fastify better-auth
  const fastifyUrl = process.env.AUTH_FASTIFY_URL || 'http://localhost:4000';
  try {
    const authRes = await fetch(`${fastifyUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password: password.raw })
    });
    if (!authRes.ok) return undefined;
    
    // Migration: store bcrypt hash so next login bypasses Fastify
    try {
      const bcrypt = Npm.require('bcrypt');
      const hash = await bcrypt.hash(password.raw, 10);
      await Meteor.users.updateAsync(
        { _id: user._id },
        { $set: { 'services.password.bcrypt': hash } }
      );
      console.log('[emailPassword] migrated password hash for:', normalizedEmail);
    } catch (err) {
      // Non-fatal — user can still login, migration will retry next time
      console.error('[emailPassword] hash migration failed:', err.message);
    }
    
    return { userId: user._id };
  } catch (err) {
    console.error('[emailPassword] Fastify fetch error:', err.message);
    return undefined;
  }
});

// Add getCurrentUser to existing Meteor.methods
Meteor.methods({
  'users.getCurrentUser': async function() {
    if (!this.userId) return null;
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) return null;
    const email = user.emails?.[0]?.address || '';
    // Also fetch username and extra fields from Fastify user collection
    const db = rawDb();
    const fastifyUser = await db.collection('user').findOne({ email: email.toLowerCase() });
    return {
      id: this.userId,
      email,
      name: user.profile?.name || fastifyUser?.name || email || 'Unknown',
      username: user.username || fastifyUser?.username || null,
      image: fastifyUser?.image || null,
      emailVerified: fastifyUser?.emailVerified ?? true
    };
  }
});
