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
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  decryptSecret,
  decryptStoredSecret,
  deriveKey,
  encryptSecret,
  previousEnvKey,
} from '../server/redmine-crypto';

const key = deriveKey('test-secret-value');

describe('redmine-crypto', () => {
  it('roundtrips a plaintext secret', () => {
    const plaintext = 'ebc3f6b781a6fb3f2b0a83ce0ebb80e0d585189d';
    expect(decryptSecret(encryptSecret(plaintext, key), key)).toBe(plaintext);
  });

  it('produces distinct ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-api-key';
    expect(encryptSecret(plaintext, key)).not.toBe(encryptSecret(plaintext, key));
  });

  it('throws on a tampered ciphertext', () => {
    const [version, iv, tag, data] = encryptSecret('secret', key).split(':');
    const flipped = data[0] === 'A' ? 'B' : 'A';
    const tampered = [version, iv, tag, `${flipped}${data.slice(1)}`].join(':');
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('throws on a malformed payload', () => {
    expect(() => decryptSecret('not-a-valid-payload', key)).toThrow('Malformed encrypted secret');
  });

  it('throws when deriving a key from an empty secret', () => {
    expect(() => deriveKey('')).toThrow('REDMINE_ENCRYPTION_KEY is not configured');
  });

  it('writes the current version prefix', () => {
    expect(encryptSecret('secret', key).split(':')[0]).toBe('v1');
  });

  it('still reads a ciphertext written before versioning existed', () => {
    // What the pre-MVP2 `encryptSecret` produced: the same three parts, no prefix.
    const unversioned = encryptSecret('legacy-api-key', key).split(':').slice(1).join(':');
    expect(decryptSecret(unversioned, key)).toBe('legacy-api-key');
  });

  it('refuses a version this build does not know, rather than guessing', () => {
    const future = `v9:${encryptSecret('secret', key).split(':').slice(1).join(':')}`;
    expect(() => decryptSecret(future, key)).toThrow(/Unsupported encrypted secret version/);
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

  it('uses the current key and reports no rotation', () => {
    process.env.REDMINE_ENCRYPTION_KEY = CURRENT;
    delete process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;

    const stored = encryptSecret('api-key', deriveKey(CURRENT));
    expect(decryptStoredSecret(stored)).toEqual({ secret: 'api-key', rotated: false });
  });

  it('falls back to the previous key mid-rotation, and says so', () => {
    process.env.REDMINE_ENCRYPTION_KEY = CURRENT;
    process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS = PREVIOUS;

    const stored = encryptSecret('api-key', deriveKey(PREVIOUS));
    expect(decryptStoredSecret(stored)).toEqual({ secret: 'api-key', rotated: true });
  });

  it('gives up when neither key opens it', () => {
    process.env.REDMINE_ENCRYPTION_KEY = CURRENT;
    process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS = PREVIOUS;

    const stored = encryptSecret('api-key', deriveKey('a-third-key'));
    expect(() => decryptStoredSecret(stored)).toThrow();
  });

  it('has no previous key unless one is configured', () => {
    delete process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS;
    expect(previousEnvKey()).toBeNull();
    process.env.REDMINE_ENCRYPTION_KEY_PREVIOUS = '';
    expect(previousEnvKey()).toBeNull();
  });
});
