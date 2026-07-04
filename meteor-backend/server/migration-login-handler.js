/**
 * Custom Meteor login handler for Better Auth → Meteor accounts migration.
 *
 * This handler allows users migrated from Better Auth to log in with their
 * original password, verified against a scrypt hash, and silently upgrades
 * them to Meteor's standard bcrypt-based accounts-password on success.
 *
 * IMPORTANT: This handler only activates for users who have:
 * - services.betterAuth.scryptHash set (format "salt:keyHex", both hex strings)
 * - NO services.password.bcrypt set yet (not already upgraded)
 *
 * The scrypt hash was produced by Better Auth using these exact parameters:
 * - N=16384, r=16, p=1, dkLen=64
 *
 * CRITICAL IMPLEMENTATION DETAIL:
 * The salt is used as a literal UTF-8 string (the hex-encoded salt string
 * itself), NOT decoded into raw bytes. This is non-standard but matches
 * Better Auth's implementation. Do not "fix" this by decoding the salt
 * from hex to bytes — it will break verification for all migrated users.
 */

import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import crypto from 'crypto';

console.log('🔐 [migration-login] Loading Better Auth migration login handler...');

// scrypt parameters matching Better Auth's implementation
const SCRYPT_N = 16384;
const SCRYPT_R = 16;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 64;

/**
 * Verify a password against a Better Auth scrypt hash.
 *
 * @param {string} password - The plaintext password to verify
 * @param {string} storedHash - The stored hash in format "salt:keyHex"
 * @returns {Promise<boolean>} - True if password matches, false otherwise
 */
async function verifyBetterAuthPassword(password, storedHash) {
  try {
    const [saltHex, expectedKeyHex] = storedHash.split(':');
    if (!saltHex || !expectedKeyHex) {
      console.error('[migration-login] Invalid hash format, expected "salt:keyHex"');
      return false;
    }

    // Normalize password (Better Auth does this before hashing)
    const normalizedPassword = password.normalize('NFKC');

    // CRITICAL: Use the hex-encoded salt string as-is, not decoded to bytes.
    // This matches Better Auth's implementation quirk.
    const saltString = saltHex;

    // Compute scrypt hash with Better Auth's parameters
    const derivedKey = await new Promise((resolve, reject) => {
      crypto.scrypt(
        normalizedPassword,
        saltString,
        SCRYPT_DKLEN,
        {
          N: SCRYPT_N,
          r: SCRYPT_R,
          p: SCRYPT_P,
          maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
        },
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        }
      );
    });

    const derivedKeyHex = derivedKey.toString('hex');
    const expectedKey = Buffer.from(expectedKeyHex, 'hex');
    const actualKey = Buffer.from(derivedKeyHex, 'hex');

    // Constant-time comparison to prevent timing attacks
    if (expectedKey.length !== actualKey.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedKey, actualKey);
  } catch (error) {
    console.error('[migration-login] Error verifying password:', error);
    return false;
  }
}

/**
 * Custom login handler for Better Auth migrated users.
 *
 * This handler intercepts login attempts and checks if the user has a
 * Better Auth scrypt hash. If so, it verifies the password against that
 * hash and upgrades the user to Meteor's bcrypt system on success.
 *
 * Returns undefined to fall through to normal handlers if:
 * - User doesn't have a betterAuth hash
 * - User already has a bcrypt password set
 * - Password verification fails
 */
Accounts.registerLoginHandler('betterAuthMigration', async function (loginRequest) {
  // Only handle emailPassword login attempts (matching auth-bridge.js payload shape)
  if (!loginRequest.emailPassword) {
    return undefined;
  }

  // Extract email and password from the emailPassword payload
  const { email, password } = loginRequest.emailPassword;
  if (!email || !password?.raw) {
    return undefined;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const rawPassword = password.raw;

  // Look up user by email (matching auth-bridge.js pattern)
  const user = await Meteor.users.findOneAsync({ 'emails.address': normalizedEmail });

  if (!user) {
    // User not found, let other handlers try
    return undefined;
  }

  // Check if this user has a Better Auth scrypt hash
  const betterAuthHash = user.services?.betterAuth?.scryptHash;
  const alreadyHasBcrypt = user.services?.password?.bcrypt;

  if (!betterAuthHash || alreadyHasBcrypt) {
    // Not a migration candidate, let normal handlers process
    return undefined;
  }

  console.log(`[migration-login] Attempting Better Auth migration for user ${user._id}`);

  // Verify password against Better Auth scrypt hash
  const isValid = await verifyBetterAuthPassword(rawPassword, betterAuthHash);

  if (!isValid) {
    console.log(`[migration-login] Password verification failed for user ${user._id}`);
    // Don't throw — just return undefined to let other handlers try
    // This prevents leaking which part of the login failed
    return undefined;
  }

  console.log(`[migration-login] Password verified, upgrading user ${user._id} to bcrypt`);

  // Password is valid! Upgrade user to Meteor's bcrypt system
  await Accounts.setPasswordAsync(user._id, rawPassword, { logout: false });

  // Mark migration as complete (optional but helpful for debugging)
  await Meteor.users.updateAsync(user._id, {
    $set: {
      'services.betterAuth.migratedToBcrypt': true,
      'services.betterAuth.migratedAt': new Date(),
    },
  });

  console.log(`[migration-login] Successfully upgraded user ${user._id} to bcrypt`);

  // Return a valid login handler result to complete the login
  return {
    userId: user._id,
    type: 'betterAuthMigration',
  };
});

Meteor.startup(() => {
  console.log('[migration-login] Better Auth migration login handler registered');
});
