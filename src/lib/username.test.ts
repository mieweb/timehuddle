import { describe, expect, it } from 'vitest';

import { USERNAME_MAX, USERNAME_MIN } from './constants';
import {
  isReserved,
  normalizeUsername,
  RESERVED_USERNAMES,
  resolveCollision,
  usernameOrId,
  validateUsername,
} from './username';

// ─── normalizeUsername ────────────────────────────────────────────────────────

describe('normalizeUsername', () => {
  it('lowercases the input', () => {
    expect(normalizeUsername('Alice')).toBe('alice');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeUsername('  bob  ')).toBe('bob');
  });

  it('replaces spaces with hyphens', () => {
    expect(normalizeUsername('john doe')).toBe('john-doe');
  });

  it('replaces underscores with hyphens', () => {
    expect(normalizeUsername('john_doe')).toBe('john-doe');
  });

  it('strips characters that are not alphanumeric or hyphen', () => {
    expect(normalizeUsername('hello!world')).toBe('helloworld');
    expect(normalizeUsername('café')).toBe('caf');
  });

  it('collapses consecutive hyphens', () => {
    expect(normalizeUsername('a--b---c')).toBe('a-b-c');
  });

  it('strips leading and trailing hyphens', () => {
    expect(normalizeUsername('-hello-')).toBe('hello');
  });

  it(`truncates to ${USERNAME_MAX} characters`, () => {
    const long = 'a'.repeat(USERNAME_MAX + 10);
    expect(normalizeUsername(long)).toHaveLength(USERNAME_MAX);
  });

  it('handles an empty string', () => {
    expect(normalizeUsername('')).toBe('');
  });
});

// ─── validateUsername ─────────────────────────────────────────────────────────

describe('validateUsername', () => {
  it('accepts a valid username', () => {
    expect(validateUsername('alice').valid).toBe(true);
  });

  it('accepts a username with hyphens and numbers', () => {
    expect(validateUsername('alice-99').valid).toBe(true);
  });

  it(`rejects usernames shorter than ${USERNAME_MIN} characters`, () => {
    const result = validateUsername('ab');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least/i);
  });

  it(`rejects usernames longer than ${USERNAME_MAX} characters`, () => {
    const result = validateUsername('a'.repeat(USERNAME_MAX + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at most/i);
  });

  it('rejects usernames starting with a hyphen', () => {
    const result = validateUsername('-alice');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/start/i);
  });

  it('rejects usernames ending with a hyphen', () => {
    const result = validateUsername('alice-');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/end/i);
  });

  it('rejects usernames with uppercase letters', () => {
    const result = validateUsername('Alice');
    expect(result.valid).toBe(false);
  });

  it('rejects usernames with special characters', () => {
    const result = validateUsername('ali_ce');
    expect(result.valid).toBe(false);
  });

  it('rejects reserved usernames', () => {
    const result = validateUsername('admin');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/reserved/i);
  });

  it(`accepts a username exactly ${USERNAME_MIN} characters long`, () => {
    const name = 'a'.repeat(USERNAME_MIN);
    expect(validateUsername(name).valid).toBe(true);
  });

  it(`accepts a username exactly ${USERNAME_MAX} characters long`, () => {
    const name = 'a'.repeat(USERNAME_MAX);
    expect(validateUsername(name).valid).toBe(true);
  });
});

// ─── isReserved ───────────────────────────────────────────────────────────────

describe('isReserved', () => {
  it('returns true for reserved names', () => {
    for (const name of RESERVED_USERNAMES) {
      expect(isReserved(name)).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(isReserved('Admin')).toBe(true);
    expect(isReserved('ADMIN')).toBe(true);
  });

  it('returns false for non-reserved names', () => {
    expect(isReserved('alice')).toBe(false);
    expect(isReserved('timehuddle-user')).toBe(false);
  });
});

// ─── resolveCollision ─────────────────────────────────────────────────────────

describe('resolveCollision', () => {
  it('returns the base name when it is not taken', () => {
    expect(resolveCollision('alice', new Set())).toBe('alice');
  });

  it('appends "2" when the base name is taken', () => {
    expect(resolveCollision('alice', new Set(['alice']))).toBe('alice2');
  });

  it('increments the suffix until an available name is found', () => {
    const taken = new Set(['alice', 'alice2', 'alice3']);
    expect(resolveCollision('alice', taken)).toBe('alice4');
  });

  it('truncates the base so the result stays within USERNAME_MAX', () => {
    const longBase = 'a'.repeat(USERNAME_MAX);
    const taken = new Set([longBase]);
    const result = resolveCollision(longBase, taken);
    expect(result.length).toBeLessThanOrEqual(USERNAME_MAX);
    expect(taken.has(result)).toBe(false);
  });

  it('resolves a fresh name with no taken names', () => {
    const result = resolveCollision('bob', new Set());
    expect(result).toBe('bob');
  });
});

// ─── usernameOrId ─────────────────────────────────────────────────────────────

describe('usernameOrId', () => {
  it('returns the username when set', () => {
    expect(usernameOrId('alice', 'abc123')).toBe('alice');
  });

  it('falls back to id when username is undefined', () => {
    expect(usernameOrId(undefined, 'abc123')).toBe('abc123');
  });

  it('falls back to id when username is null', () => {
    expect(usernameOrId(null, 'abc123')).toBe('abc123');
  });

  it('falls back to id when username is an empty string', () => {
    expect(usernameOrId('', 'abc123')).toBe('abc123');
  });

  it('falls back to id when username is whitespace only', () => {
    expect(usernameOrId('   ', 'abc123')).toBe('abc123');
  });
});
