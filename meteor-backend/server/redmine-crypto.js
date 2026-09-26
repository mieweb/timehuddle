/**
 * Symmetric encryption for secrets stored at rest (personal Redmine API keys).
 *
 * AES-256-GCM gives us confidentiality plus an authentication tag, so a tampered
 * or truncated ciphertext fails loudly on decrypt instead of yielding garbage.
 *
 * Ciphertexts carry a version prefix (`v1:iv:tag:data`) so the format can change
 * without a migration: an unprefixed value is the original format and still
 * decrypts. And `REDMINE_ENCRYPTION_KEY_PREVIOUS` lets the key itself be rotated
 * without invalidating every stored key at once — `decryptStoredSecret` tries the
 * current key, falls back to the previous one, and says which it used so the
 * caller can re-encrypt.
 *
 * The functions are pure and take the derived key explicitly so they can be
 * unit-tested without any environment setup (see tests/redmine-crypto.test.ts).
 * `envKey()` and `decryptStoredSecret()` are the env-coupled conveniences callers
 * use at runtime.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce — the recommended size for GCM.

/**
 * The format new ciphertexts are written in. Values stored before versioning
 * exist and have no prefix; they are read as this same format, which is what
 * `v1` describes. The prefix is here so the *next* change needs no migration.
 */
const CURRENT_VERSION = 'v1';

/**
 * Derive a 32-byte AES key from an arbitrary-length secret string.
 * SHA-256 gives a fixed 256-bit key regardless of the secret's length.
 */
export function deriveKey(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('REDMINE_ENCRYPTION_KEY is not configured');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Encrypt a UTF-8 plaintext. Returns a self-describing string
 * `v1:iv:authTag:ciphertext` (each part after the version base64), so decrypt
 * needs only the key.
 */
export function encryptSecret(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    CURRENT_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a payload produced by `encryptSecret`, with or without a version
 * prefix. Throws if the payload is malformed, if its version is one this build
 * does not know, or if the auth tag does not verify (tampering / wrong key).
 */
export function decryptSecret(payload, key) {
  const parts = String(payload).split(':');

  // Three parts is the original, unversioned format: every key stored before
  // versioning, and still perfectly readable.
  const [version, ivB64, authTagB64, dataB64] =
    parts.length === 3 ? [CURRENT_VERSION, ...parts] : parts;

  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error('Malformed encrypted secret');
  }
  if (version !== CURRENT_VERSION) {
    throw new Error(`Unsupported encrypted secret version: ${version}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Runtime key derived from the `REDMINE_ENCRYPTION_KEY` env var. */
export function envKey() {
  return deriveKey(process.env.REDMINE_ENCRYPTION_KEY);
}

/**
 * The key being rotated away from (`REDMINE_ENCRYPTION_KEY_PREVIOUS`), or null
 * when no rotation is in progress.
 */
export function previousEnvKey() {
  const secret = process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;
  return typeof secret === 'string' && secret.length > 0 ? deriveKey(secret) : null;
}

/**
 * Decrypt a stored secret under whichever key still opens it.
 *
 * `rotated: true` means the previous key was the one that worked, so the caller
 * should write the value back encrypted under the current key. Without this,
 * changing `REDMINE_ENCRYPTION_KEY` would make every stored API key
 * undecryptable at once and send every user back to Settings to re-paste theirs.
 *
 * The current key is always tried first, so a completed rotation costs nothing.
 *
 * @returns {{secret: string, rotated: boolean}}
 */
export function decryptStoredSecret(payload) {
  try {
    return { secret: decryptSecret(payload, envKey()), rotated: false };
  } catch (err) {
    const previous = previousEnvKey();
    if (!previous) throw err;
    return { secret: decryptSecret(payload, previous), rotated: true };
  }
}
