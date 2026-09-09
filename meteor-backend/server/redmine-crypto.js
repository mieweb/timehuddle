/**
 * Symmetric encryption for secrets stored at rest (personal Redmine API keys).
 *
 * AES-256-GCM gives us confidentiality plus an authentication tag, so a tampered
 * or truncated ciphertext fails loudly on decrypt instead of yielding garbage.
 *
 * The functions are pure and take the derived key explicitly so they can be
 * unit-tested without any environment setup (see tests/redmine-crypto.test.ts).
 * `envKey()` is the one env-coupled convenience used by callers at runtime.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce — the recommended size for GCM.

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
 * `iv:authTag:ciphertext` (each part base64), so decrypt needs only the key.
 */
export function encryptSecret(plaintext, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a payload produced by `encryptSecret`. Throws if the payload is
 * malformed or if the auth tag does not verify (tampering / wrong key).
 */
export function decryptSecret(payload, key) {
  const parts = String(payload).split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted secret');
  }
  const [ivB64, authTagB64, dataB64] = parts;
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
