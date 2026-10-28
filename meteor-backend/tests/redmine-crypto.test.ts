/**
 * Unit tests for redmine-crypto (server/redmine-crypto.js).
 *
 * These guard the at-rest encryption of personal Redmine API keys: a correct
 * roundtrip, a fresh IV per call (so identical plaintext never yields identical
 * ciphertext), and GCM tamper-detection on decrypt.
 *
 * MVP2 A4 adds two more promises, both about not locking anyone out. A ciphertext
 * written before versioning existed still decrypts, and the encryption key itself
 * can be rotated without every stored API key becoming unreadable at once.
 *
 * #734 step 7 locks each key to its owner (`v2`), while `v1` keys still open
 * and are rewritten on their next use.
 */
import { createCipheriv, randomBytes } from 'crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  decryptSecret,
  decryptStoredSecret,
  deriveKey,
  encryptSecret,
  envKey,
  isStrongSecret,
  previousEnvKey,
  secretVersion,
  weakSecretNames,
} from '../server/redmine-crypto';

const key = deriveKey('test-secret-value');
const OWNER = 'user-1';

/** A `v1` ciphertext, as `encryptSecret` wrote before keys were locked to their owner. */
function encryptV1(plaintext: string, aesKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64'));
  return ['v1', ...parts].join(':');
}

describe('redmine-crypto', () => {
  it('roundtrips a plaintext secret', () => {
    const plaintext = 'ebc3f6b781a6fb3f2b0a83ce0ebb80e0d585189d';
    expect(decryptSecret(encryptSecret(plaintext, key, OWNER), key, OWNER)).toBe(plaintext);
  });

  it('produces distinct ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-api-key';
    expect(encryptSecret(plaintext, key, OWNER)).not.toBe(encryptSecret(plaintext, key, OWNER));
  });

  it('throws on a tampered ciphertext', () => {
    const [version, iv, tag, data] = encryptSecret('secret', key, OWNER).split(':');
    const flipped = data[0] === 'A' ? 'B' : 'A';
    const tampered = [version, iv, tag, `${flipped}${data.slice(1)}`].join(':');
    expect(() => decryptSecret(tampered, key, OWNER)).toThrow();
  });

  it('throws on a malformed payload', () => {
    expect(() => decryptSecret('not-a-valid-payload', key, OWNER)).toThrow('Malformed encrypted secret');
  });

  it('throws when deriving a key from an empty secret', () => {
    expect(() => deriveKey('')).toThrow('SOURCE_KEYS_SECRET is not configured');
  });

  it('writes v2, locked to its owner', () => {
    const stored = encryptSecret('secret', key, OWNER);
    expect(stored.split(':')[0]).toBe('v2');
    expect(secretVersion(stored)).toBe('v2');
  });

  it("doesn't open a key copied onto another member's row", () => {
    const stored = encryptSecret('secret', key, OWNER);
    expect(() => decryptSecret(stored, key, 'user-2')).toThrow();
  });

  it('refuses to encrypt without an owner', () => {
    expect(() => encryptSecret('secret', key, '')).toThrow(/owner/);
  });

  it('still reads v1, and a ciphertext written before versioning existed', () => {
    const v1 = encryptV1('legacy-api-key', key);
    expect(secretVersion(v1)).toBe('v1');
    expect(decryptSecret(v1, key, OWNER)).toBe('legacy-api-key');
    const unversioned = v1.split(':').slice(1).join(':');
    expect(secretVersion(unversioned)).toBe('v1');
    expect(decryptSecret(unversioned, key, OWNER)).toBe('legacy-api-key');
  });

  it('refuses a version this build does not know, rather than guessing', () => {
    const future = `v9:${encryptSecret('secret', key, OWNER).split(':').slice(1).join(':')}`;
    expect(() => decryptSecret(future, key, OWNER)).toThrow(/Unsupported encrypted secret version/);
  });
});

describe('decryptStoredSecret', () => {
  const CURRENT = 'current-encryption-key';
  const PREVIOUS = 'previous-encryption-key';
  const saved = {
    current: process.env.REDMINE_ENCRYPTION_KEY,
    previous: process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS,
  };

  afterEach(() => {
    process.env.REDMINE_ENCRYPTION_KEY = saved.current ?? '';
    if (saved.previous === undefined) delete process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;
    else process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS = saved.previous;
  });

  it('uses the current key and asks for no rewrite', () => {
    process.env.REDMINE_ENCRYPTION_KEY = CURRENT;
    delete process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;

    const stored = encryptSecret('api-key', deriveKey(CURRENT), OWNER);
    expect(decryptStoredSecret(stored, OWNER)).toEqual({ secret: 'api-key', rewrite: false });
  });

  it('asks for a rewrite of a key stored before keys were locked to their owner', () => {
    process.env.REDMINE_ENCRYPTION_KEY = CURRENT;
    delete process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;

    const stored = encryptV1('api-key', deriveKey(CURRENT));
    expect(decryptStoredSecret(stored, OWNER)).toEqual({ secret: 'api-key', rewrite: true });
  });

  it('falls back to the previous key mid-rotation, and asks for a rewrite', () => {
    process.env.REDMINE_ENCRYPTION_KEY = CURRENT;
    process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS = PREVIOUS;

    const stored = encryptSecret('api-key', deriveKey(PREVIOUS), OWNER);
    expect(decryptStoredSecret(stored, OWNER)).toEqual({ secret: 'api-key', rewrite: true });
  });

  it('gives up when neither key opens it', () => {
    process.env.REDMINE_ENCRYPTION_KEY = CURRENT;
    process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS = PREVIOUS;

    const stored = encryptSecret('api-key', deriveKey('a-third-key'), OWNER);
    expect(() => decryptStoredSecret(stored, OWNER)).toThrow();
  });

  it('has no previous key unless one is configured', () => {
    delete process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;
    expect(previousEnvKey()).toBeNull();
    process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS = '';
    expect(previousEnvKey()).toBeNull();
  });
});

describe('the keys secret (#734 step 7)', () => {
  const NAMES = [
    'SOURCE_KEYS_SECRET',
    'SOURCE_KEYS_SECRET_PREVIOUS',
    'REDMINE_ENCRYPTION_KEY',
    'REDMINE_ENCRYPTION_KEY_PREVIOUS',
  ];
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  const STRONG = 'Qk3pXQ1zv0b8C2m7yH5nT9sW4eR6uJ1aL8dF3gK0oP4=';

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('takes base64 or hex for at least 32 bytes as strong, and a passphrase as weak', () => {
    expect(isStrongSecret(STRONG)).toBe(true);
    expect(isStrongSecret('ab'.repeat(32))).toBe(true);
    expect(isStrongSecret('ab'.repeat(16))).toBe(false);
    expect(isStrongSecret('e2e-only-throwaway-key')).toBe(false);
    expect(isStrongSecret('correct horse battery staple and then some more words')).toBe(false);
  });

  it('prefers SOURCE_KEYS_SECRET, and still reads REDMINE_ENCRYPTION_KEY alone', () => {
    process.env.REDMINE_ENCRYPTION_KEY = 'old-secret';
    delete process.env.SOURCE_KEYS_SECRET;
    expect(envKey()).toEqual(deriveKey('old-secret'));
    process.env.SOURCE_KEYS_SECRET = STRONG;
    expect(envKey()).toEqual(deriveKey(STRONG));
  });

  it('names the weak secrets that are in use, for the boot warning', () => {
    for (const name of NAMES) delete process.env[name];
    process.env.REDMINE_ENCRYPTION_KEY = 'weak';
    expect(weakSecretNames()).toEqual(['REDMINE_ENCRYPTION_KEY']);
    // Shadowed by a strong SOURCE_KEYS_SECRET, the old one isn't used.
    process.env.SOURCE_KEYS_SECRET = STRONG;
    expect(weakSecretNames()).toEqual([]);
  });
});
