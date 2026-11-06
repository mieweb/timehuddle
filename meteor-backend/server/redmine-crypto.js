/**
 * Symmetric encryption for secrets stored at rest (members' personal keys for
 * outside servers, Redmine's so far).
 *
 * AES-256-GCM gives us confidentiality plus an authentication tag, so a tampered
 * or truncated ciphertext fails loudly on decrypt instead of yielding garbage.
 *
 * Ciphertexts carry a version prefix (`v2:iv:tag:data`) so the format can change
 * without a migration: `v1` and the unprefixed original still decrypt, and the
 * caller rewrites them as `v2` on their next use. A `v2` ciphertext is locked to
 * its owner (the member, and their server once accounts are per server): the
 * owner is GCM additional data, so a key copied onto another member's row
 * fails to decrypt (#734 step 7). And `REDMINE_ENCRYPTION_KEY_PREVIOUS` lets the key itself be rotated
 * without invalidating every stored key at once — `decryptStoredSecret` tries the
 * current key, falls back to the previous one, and says which it used so the
 * caller can re-encrypt.
 *
 * The secret is `SOURCE_KEYS_SECRET`, one for every connector, or
 * `REDMINE_ENCRYPTION_KEY` where a deployment still sets only that (#734 step 7).
 * It should be random (`openssl rand -base64 32`); `weakSecretNames()` names the
 * ones that aren't, for a warning at boot.
 *
 * The functions are pure and take the derived key explicitly; `envKey()` and
 * `decryptStoredSecret()` are the env-coupled conveniences callers use at runtime.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce — the recommended size for GCM.

/** The format new ciphertexts are written in: locked to their owner. */
const CURRENT_VERSION = 'v2';

/**
 * The format before owners were bound: no additional data. Values stored
 * before versioning have no prefix and are read as this.
 */
const UNBOUND_VERSION = 'v1';

/**
 * Derive a 32-byte AES key from an arbitrary-length secret string.
 * SHA-256 gives a fixed 256-bit key regardless of the secret's length.
 */
export function deriveKey(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('SOURCE_KEYS_SECRET is not configured');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** The bytes a secret written as base64 or hex stands for, or null when it is neither. */
function decodedSecret(secret) {
  const text = secret.trim();
  if (/^(?:[0-9a-f]{2})+$/i.test(text)) return Buffer.from(text, 'hex');
  // Node's base64 reads the URL-safe alphabet too.
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(text) ? Buffer.from(text, 'base64') : null;
}

/**
 * Whether `secret` is random enough to encrypt keys with: base64 or hex for at
 * least 32 bytes, as `openssl rand -base64 32` gives. A passphrase isn't.
 */
export function isStrongSecret(secret) {
  if (typeof secret !== 'string') return false;
  const bytes = decodedSecret(secret);
  return Boolean(bytes && bytes.length >= 32);
}

/** The env var holding the current secret, and the one being rotated away from. */
function currentSecret() {
  return process.env.SOURCE_KEYS_SECRET || process.env.REDMINE_ENCRYPTION_KEY;
}
function previousSecret() {
  return process.env.SOURCE_KEYS_SECRET_PREVIOUS || process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;
}

/** Whether a secret to encrypt keys with is set at all. */
export function hasKeysSecret() {
  return Boolean(currentSecret());
}

/**
 * The names of the secrets that are set but weak (see `isStrongSecret`), for
 * the boot warning. Empty when every set secret is strong.
 */
export function weakSecretNames() {
  return [
    ['SOURCE_KEYS_SECRET', process.env.SOURCE_KEYS_SECRET],
    ['REDMINE_ENCRYPTION_KEY', process.env.SOURCE_KEYS_SECRET ? null : process.env.REDMINE_ENCRYPTION_KEY],
    ['SOURCE_KEYS_SECRET_PREVIOUS', process.env.SOURCE_KEYS_SECRET_PREVIOUS],
    [
      'REDMINE_ENCRYPTION_KEY_PREVIOUS',
      process.env.SOURCE_KEYS_SECRET_PREVIOUS ? null : process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS,
    ],
  ]
    .filter(([, secret]) => secret && !isStrongSecret(secret))
    .map(([name]) => name);
}

// Each secret's AES key, worked out once rather than on every decrypt. Keyed by
// the secret, so a changed env (tests) gets its own.
const derivedKeys = new Map();
function cachedKey(secret) {
  if (!derivedKeys.has(secret)) derivedKeys.set(secret, deriveKey(secret));
  return derivedKeys.get(secret);
}

/**
 * Encrypt a UTF-8 plaintext for `owner` (see `keyOwnerOf` in
 * redmine-account.js). Returns a self-describing string
 * `v2:iv:authTag:ciphertext` (each part after the version base64), which
 * decrypts only with the key and the same owner.
 */
export function encryptSecret(plaintext, key, owner) {
  if (typeof owner !== 'string' || !owner) throw new Error('A secret is encrypted for an owner');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(owner, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    CURRENT_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/** The version a stored payload is in: unprefixed values are `v1`. */
export function secretVersion(payload) {
  const parts = String(payload).split(':');
  return parts.length === 3 ? UNBOUND_VERSION : parts[0];
}

/**
 * Decrypt a payload produced by `encryptSecret` for `owner`, or an older `v1`
 * or unprefixed one (which have no owner). Throws if the payload is malformed,
 * if its version is one this build does not know, or if the auth tag does not
 * verify (tampering, wrong key, or another owner's key).
 */
export function decryptSecret(payload, key, owner) {
  const parts = String(payload).split(':');

  // Three parts is the original, unversioned format: every key stored before
  // versioning, and still perfectly readable.
  const [version, ivB64, authTagB64, dataB64] =
    parts.length === 3 ? [UNBOUND_VERSION, ...parts] : parts;

  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error('Malformed encrypted secret');
  }
  if (version !== CURRENT_VERSION && version !== UNBOUND_VERSION) {
    throw new Error(`Unsupported encrypted secret version: ${version}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  if (version === CURRENT_VERSION) decipher.setAAD(Buffer.from(String(owner ?? ''), 'utf8'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Runtime key derived from the current secret. */
export function envKey() {
  return cachedKey(currentSecret());
}

/**
 * The key being rotated away from (`SOURCE_KEYS_SECRET_PREVIOUS`, or
 * `REDMINE_ENCRYPTION_KEY_PREVIOUS`), or null when no rotation is in progress.
 */
export function previousEnvKey() {
  const secret = previousSecret();
  return typeof secret === 'string' && secret.length > 0 ? cachedKey(secret) : null;
}

/**
 * Decrypt `owner`'s stored secret under whichever key still opens it.
 *
 * `rewrite: true` means the caller should write the value back with
 * `encryptSecret(secret, envKey(), owner)`: the previous key was the one that
 * worked, or the value is in an older format that isn't locked to its owner.
 * Without this, changing the secret would make every stored key undecryptable
 * at once and send every member back to Settings to re-paste theirs; and old
 * keys would never become locked without a bulk migration.
 *
 * The current key is always tried first, so a completed rotation costs nothing.
 *
 * @returns {{secret: string, rewrite: boolean}}
 */
export function decryptStoredSecret(payload, owner) {
  const outdated = secretVersion(payload) !== CURRENT_VERSION;
  try {
    return { secret: decryptSecret(payload, envKey(), owner), rewrite: outdated };
  } catch (err) {
    const previous = previousEnvKey();
    if (!previous) throw err;
    return { secret: decryptSecret(payload, previous, owner), rewrite: true };
  }
}
