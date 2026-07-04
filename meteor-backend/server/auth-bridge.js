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
import { jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';
import { currentBearerToken } from 'meteor/wreiske:meteor-wormhole';
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

// Configure Accounts to expire login tokens after 30 days
Meteor.startup(() => {
  Accounts.config({
    loginExpirationInDays: 30,
  });

  // Password reset URL — points to the frontend React app (APP_URL) rather
  // than Meteor's default `/#/reset-password/:token`. Uses query param format
  // so React Router can pick it up: /reset-password?token=<token>
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  Accounts.urls.resetPassword = (token) => `${appUrl}/reset-password?token=${token}`;

  // Branded email templates for account lifecycle emails.
  Accounts.emailTemplates.siteName = 'TimeHuddle';
  Accounts.emailTemplates.from = process.env.EMAIL_FROM || 'TimeHuddle <noreply@timehuddle.local>';

  Accounts.emailTemplates.resetPassword = {
    subject() {
      return 'Reset your TimeHuddle password';
    },
    text(user, url) {
      const name = user.profile?.name || user.emails?.[0]?.address || 'there';
      return `Hi ${name},\n\nA password reset was requested for your TimeHuddle account. Click the link below to choose a new password:\n\n${url}\n\nThis link will expire in a few days. If you didn't request this, you can safely ignore this email.\n\n— The TimeHuddle team`;
    },
    html(user, url) {
      const name = user.profile?.name || user.emails?.[0]?.address || 'there';
      return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f7;padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
            <tr>
              <td style="padding:32px 40px;background:#111827;color:#ffffff;">
                <h1 style="margin:0;font-size:22px;font-weight:600;">TimeHuddle</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Reset your password</h2>
                <p style="margin:0 0 16px;color:#374151;line-height:1.6;">Hi ${name},</p>
                <p style="margin:0 0 24px;color:#374151;line-height:1.6;">A password reset was requested for your TimeHuddle account. Click the button below to choose a new password.</p>
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="border-radius:8px;background:#2563eb;">
                      <a href="${url}" style="display:inline-block;padding:12px 24px;font-size:15px;color:#ffffff;text-decoration:none;font-weight:600;">Reset password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 8px;color:#6b7280;font-size:13px;line-height:1.6;">Or paste this link into your browser:</p>
                <p style="margin:0 0 24px;color:#2563eb;font-size:13px;word-break:break-all;"><a href="${url}" style="color:#2563eb;text-decoration:underline;">${url}</a></p>
                <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">This link will expire in a few days. If you didn't request this, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px;background:#f9fafb;color:#9ca3af;font-size:12px;text-align:center;">
                &copy; TimeHuddle
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
    },
  };
});

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
}

/**
 * Check if a user is blocked from ALL their organizations.
 * Returns { blocked: false } if user can access at least one org.
 * Returns { blocked: true, message } if blocked from all orgs.
 */
async function checkUserBlocking(userId) {
  const db = rawDb();
  // Load user blocked field from Meteor users collection
  const usersDoc = await db.collection('users').findOne(
    { _id: String(userId) }, 
    { projection: { blocked: 1 } }
  );
  
  const blockedArray = usersDoc?.blocked ?? [];
  
  if (blockedArray.length === 0) return { blocked: false };

  // Load org_members to check which orgs user belongs to
  const memberships = await db.collection('org_members').find({ userId: String(userId) }).toArray();
  const memberOrgIds = new Set(memberships.map((m) => m.orgId));
  
  // Check if user has at least one org they're a member of AND NOT blocked from
  const blockedOrgIds = new Set(blockedArray.map((b) => b.orgId));
  const hasAccessibleOrg = Array.from(memberOrgIds).some((orgId) => !blockedOrgIds.has(orgId));
  
  if (hasAccessibleOrg) return { blocked: false };

  // Blocked from all orgs they're a member of
  const reason = blockedArray[0]?.reason;
  const message = reason
    ? `Your account has been suspended: ${reason}`
    : 'Your account has been suspended. Please contact your administrator.';
  return { blocked: true, message };
}

export async function findUserById(id) {
  // Query Meteor users collection
  const meteorUser = await rawDb().collection('users').findOne({ _id: String(id) });
  if (!meteorUser) return null;
  
  return {
    _id: meteorUser._id,
    name: meteorUser.profile?.name ?? null,
    email: meteorUser.emails?.[0]?.address ?? null,
    username: meteorUser.username ?? null,
    image: meteorUser.image ?? null,
    bio: meteorUser.bio ?? '',
    website: meteorUser.website ?? '',
    reportsToUserId: meteorUser.reportsToUserId ?? null,
  };
}

/** A JWT has exactly three dot-separated segments. */
function looksLikeJwt(token) {
  return token.split('.').length === 3;
}

async function resolveJwt(token) {
  try {
    jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
    const { payload } = await jwtVerify(token, jwks);
    if (!payload.sub) {
      console.log('[auth-bridge] JWT missing sub claim');
      return null;
    }
    console.log('[auth-bridge] JWT verified for user:', payload.sub);
    return { userId: payload.sub, name: payload.name || payload.email || 'Unknown' };
  } catch (err) {
    console.log('[auth-bridge] JWT verification failed:', err.message);
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
  const user = await findUserById(pat.userId);
  return { userId: String(pat.userId), name: user?.name ?? user?.email ?? 'Unknown' };
}

async function resolveMeteorToken(token) {
  const { createHash } = Npm.require('crypto');
  const hashedToken = createHash('sha256').update(token).digest('base64');
  
  console.log('[auth-bridge] Looking for Meteor token hash:', hashedToken.substring(0, 20) + '...');
  
  const user = await Meteor.users.findOneAsync({
    'services.resume.loginTokens.hashedToken': hashedToken
  });
  
  if (!user) {
    console.log('[auth-bridge] No user found with that token hash');
    return null;
  }
  
  console.log('[auth-bridge] Meteor token resolved for user:', user._id);
  return {
    userId: user._id,
    name: user.profile?.name || user.emails?.[0]?.address || 'Unknown'
  };
}

/** Resolve a bearer token (JWT, PAT, or Meteor resume token) to { userId, name } or null. */
export async function resolveToken(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const token = raw.trim();
  if (token.startsWith(PAT_PREFIX)) {
    console.log('[auth-bridge] Trying PAT resolution');
    return resolvePat(token);
  }
  if (looksLikeJwt(token)) {
    console.log('[auth-bridge] Trying JWT resolution');
    return resolveJwt(token);
  }
  // Try as Meteor resume token
  console.log('[auth-bridge] Trying Meteor resume token resolution');
  const meteorIdentity = await resolveMeteorToken(token);
  if (meteorIdentity) return meteorIdentity;
  return null;
}

/**
 * Find or create a Meteor user account by email.
 * Used by login handlers to ensure a user exists before returning userId.
 */
export async function findOrCreateUser(email, name) {
  const normalizedEmail = email.toLowerCase().trim()

  // Check if Meteor user already exists
  const existingMeteorUser = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail })
  if (existingMeteorUser?._id) {
    console.log('[auth-bridge] found existing Meteor user:', existingMeteorUser._id)
    return existingMeteorUser._id
  }

  // Create new user in Meteor Accounts
  console.log('[auth-bridge] creating new Meteor user:', normalizedEmail)
  try {
    const userId = Accounts.createUser({
      email: normalizedEmail,
      profile: { name: name || normalizedEmail }
    })
    console.log('[auth-bridge] created new user:', userId)
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
// Login Validation - Block users who are blocked from all their organizations
// ============================================================================

Accounts.validateLoginAttempt(async (attempt) => {
  // Only validate successful login attempts
  if (!attempt.allowed) return false;
  
  const userId = attempt.user?._id;
  if (!userId) return true; // No user ID, let it through (shouldn't happen)
  
  try {
    const blockCheck = await checkUserBlocking(String(userId));
    if (blockCheck.blocked) {
      throw new Meteor.Error('account-blocked', blockCheck.message);
    }
    return true;
  } catch (err) {
    if (err.error === 'account-blocked') {
      throw err; // Re-throw blocking errors
    }
    console.error('[auth-bridge] Blocking check failed:', err);
    return true; // Allow login on check failure to avoid locking out users
  }
});

// ============================================================================
// GitHub OAuth User Sync
// ============================================================================

// OAuth users are stored directly in Meteor Accounts - no sync needed
Accounts.onLogin(async (info) => {
  const user = info.user;
  if (!user) {
    console.log('[auth-bridge] onLogin called but no user found');
    return;
  }
  
  if (user.services?.github || user.services?.google) {
    const email = user.services?.github?.email || user.services?.google?.email || user.emails?.[0]?.address;
    console.log('[auth-bridge] OAuth user logged in:', email);
  }

  // Auto-join default organization if user has no org memberships
  try {
    const userId = String(user._id);
    const { rawDb } = await import('./collections');
    const db = rawDb();
    
    // Check if user already has any org memberships
    const existingMembership = await db.collection('org_members').findOne({ userId });
    if (existingMembership) {
      console.log('[auth-bridge] user already has org membership, skipping auto-join');
      return;
    }

    // Find default org with allowAutoJoin enabled
    const defaultOrg = await db.collection('organizations').findOne({ 
      slug: process.env.DEFAULT_ORG_KEY || 'default',
      allowAutoJoin: true
    });
    
    if (!defaultOrg || !defaultOrg._id) {
      console.log('[auth-bridge] no default org with auto-join enabled or org has no _id');
      return;
    }

    // Add user to default org as member
    const { ObjectId } = await import('mongodb');
    const now = new Date();
    const orgIdString = typeof defaultOrg._id === 'string' ? defaultOrg._id : String(defaultOrg._id);
    await db.collection('org_members').insertOne({
      _id: new ObjectId(),
      orgId: orgIdString,
      userId,
      role: 'member',
      auto: true,
      createdAt: now,
      updatedAt: now,
    });
    
    console.log(`[auth-bridge] auto-joined user ${userId} to org ${defaultOrg.name}`);
  } catch (err) {
    console.error('[auth-bridge] auto-join error:', err.message);
    // Don't fail login if auto-join fails
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
    
    console.log('[auth-bridge] created new user via accounts.createUser:', userId);
    return { userId };
  },

  'accounts.sendResetPasswordEmail': async function({ email }) {
    if (!email || typeof email !== 'string') {
      throw new Meteor.Error('invalid-params', 'Email is required');
    }
    const normalizedEmail = email.toLowerCase().trim();
    const user = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail });
    // Don't reveal if email exists — always return ok
    if (!user) return { ok: true };

    if (!process.env.MAIL_URL) {
      throw new Meteor.Error('smtp-not-configured',
        'Password reset emails are not configured yet. Please contact your administrator.');
    }
    try {
      await Accounts.sendResetPasswordEmail(user._id);
    } catch (err) {
      console.error('[auth-bridge] sendResetPasswordEmail failed:', err);
      throw new Meteor.Error('send-failed', 'Failed to send reset email. Please try again later.');
    }
    return { ok: true };
  },

  'accounts.resetPassword': async function({ token, newPassword }) {
    if (!token || !newPassword) {
      throw new Meteor.Error('invalid-params', 'Token and new password are required');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new Meteor.Error('weak-password', 'Password must be at least 8 characters');
    }
    // Server-side reset: Accounts.resetPassword is client-only. We look up the
    // user by the reset token stored in services.password.reset, verify it
    // hasn't expired, set the new password, and remove the reset token.
    const user = await Meteor.users.findOneAsync({ 'services.password.reset.token': token });
    if (!user) {
      throw new Meteor.Error('invalid-token', 'Invalid or expired reset token');
    }
    const resetInfo = user.services?.password?.reset;
    const expirationMs = (Accounts._options.passwordResetTokenExpirationInDays ?? 3) * 24 * 60 * 60 * 1000;
    if (resetInfo?.when && Date.now() - new Date(resetInfo.when).getTime() > expirationMs) {
      throw new Meteor.Error('expired-token', 'Reset token has expired');
    }
    await Accounts.setPasswordAsync(user._id, newPassword, { logout: true });
    // Clear the reset token so it can't be reused
    await Meteor.users.updateAsync(user._id, {
      $unset: { 'services.password.reset': '' },
    });
    return { ok: true };
  },

  'users.getCurrentUser': async function() {
    if (!this.userId) return null;
    const user = await Meteor.users.findOneAsync(this.userId);
    if (!user) return null;
    const email = user.emails?.[0]?.address || '';
    return {
      id: this.userId,
      email,
      name: user.profile?.name || email || 'Unknown',
      username: user.username || null,
      image: user.image || null,
      emailVerified: user.emails?.[0]?.verified ?? false
    };
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
  let user = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail });

  // Path 1: Meteor user exists with bcrypt hash — verify natively.
  // Meteor's Accounts.setPasswordAsync stores bcrypt(sha256hex(password)), so
  // we must try both the raw password AND its sha256 digest (computed here if
  // the client couldn't send one, e.g. non-secure browser context where
  // crypto.subtle is undefined).
  const storedBcrypt = user?.services?.password?.bcrypt;
  if (storedBcrypt) {
    const bcrypt = Npm.require('bcrypt');
    const clientDigest = password.digest && password.digest.length > 0
      ? password.digest
      : createHash('sha256').update(password.raw).digest('hex');
    let match = await bcrypt.compare(clientDigest, storedBcrypt);
    if (!match) {
      // Legacy: some users may have bcrypt of the raw password (from Fastify migration path).
      match = await bcrypt.compare(password.raw, storedBcrypt);
    }
    if (!match) throw new Meteor.Error(403, 'Invalid email or password');
    const blockCheck = await checkUserBlocking(String(user._id));
    if (blockCheck.blocked) throw new Meteor.Error(403, blockCheck.message || 'Account suspended');
    return { userId: String(user._id) };
  }

  // Check if this is a Better Auth user that needs to reset their password
  if (user?.services?.betterAuth?.scryptHash) {
    // Generate a password reset token automatically
    const token = await Accounts._generateStampedLoginToken();
    
    // Ensure services.password exists, then set reset as an array
    await Meteor.users.updateAsync(user._id, {
      $set: {
        'services.password': user.services?.password || {},
      },
    });
    
    await Meteor.users.updateAsync(user._id, {
      $set: {
        'services.password.reset': [{
          token: token.token,
          email: normalizedEmail,
          when: new Date(),
        }],
      },
    });
    
    throw new Meteor.Error(
      'BETTER_AUTH_MIGRATION_REQUIRED',
      JSON.stringify({
        message: 'Your account needs to be migrated. Redirecting to password reset...',
        token: token.token,
      }),
    );
  }

  // No bcrypt hash — user doesn't exist or password not set
  throw new Meteor.Error(403, 'Invalid email or password');
});
