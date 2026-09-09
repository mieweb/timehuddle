/**
 * Unit tests for redmine-crypto (server/redmine-crypto.js).
 *
 * These guard the at-rest encryption of personal Redmine API keys: a correct
 * roundtrip, a fresh IV per call (so identical plaintext never yields identical
 * ciphertext), and GCM tamper-detection on decrypt.
 */
import { describe, it, expect } from 'vitest';

import { deriveKey, encryptSecret, decryptSecret } from '../server/redmine-crypto';

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
    const payload = encryptSecret('secret', key);
    const [iv, tag, data] = payload.split(':');
    const flipped = data[0] === 'A' ? 'B' : 'A';
    const tampered = `${iv}:${tag}:${flipped}${data.slice(1)}`;
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('throws on a malformed payload', () => {
    expect(() => decryptSecret('not-a-valid-payload', key)).toThrow('Malformed encrypted secret');
  });

  it('throws when deriving a key from an empty secret', () => {
    expect(() => deriveKey('')).toThrow('REDMINE_ENCRYPTION_KEY is not configured');
  });
});
