import { describe, expect, it } from 'vitest';

import {
  VERSION_RE,
  compareVersions,
  isNewer,
  isOlder,
  isValidVersion,
  versionTuple,
} from './index.js';

describe('versionTuple', () => {
  it('parses a plain semver', () => {
    expect(versionTuple('1.2.3')).toEqual([1, 2, 3]);
  });

  it('tolerates a leading v and a prerelease tag', () => {
    expect(versionTuple('v1.2.3-beta.1')).toEqual([1, 2, 3]);
    expect(versionTuple('1.2.3+build.7')).toEqual([1, 2, 3]);
  });

  it('pads a short version', () => {
    expect(versionTuple('1.0')).toEqual([1, 0, 0]);
    expect(versionTuple('2')).toEqual([2, 0, 0]);
  });

  // Nothing is older than 0.0.0, which is what makes a missing minVersion
  // fail safe rather than gating every client.
  it('degrades unparseable input to zeroes', () => {
    expect(versionTuple(undefined)).toEqual([0, 0, 0]);
    expect(versionTuple('')).toEqual([0, 0, 0]);
    expect(versionTuple('not-a-version')).toEqual([0, 0, 0]);
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.1.2', '1.1.3')).toBe(-1);
  });

  it('treats equal cores as equal regardless of prerelease', () => {
    expect(compareVersions('1.0.5', '1.0.5')).toBe(0);
    expect(compareVersions('1.0.5-beta.1', '1.0.5')).toBe(0);
  });

  it('does not compare numerically as strings', () => {
    // "1.0.10" > "1.0.9" numerically, but string comparison gets this wrong.
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
  });
});

describe('isOlder / isNewer', () => {
  it('are strict and mutually exclusive', () => {
    expect(isOlder('1.0.1', '1.0.4')).toBe(true);
    expect(isNewer('1.0.1', '1.0.4')).toBe(false);
    expect(isOlder('1.0.4', '1.0.4')).toBe(false);
    expect(isNewer('1.0.4', '1.0.4')).toBe(false);
    expect(isNewer('1.0.5', '1.0.4')).toBe(true);
  });

  it('never reports anything as older than a missing version', () => {
    expect(isOlder('1.0.1', undefined)).toBe(false);
    expect(isOlder('0.0.0', undefined)).toBe(false);
  });
});

describe('isValidVersion / VERSION_RE', () => {
  it('accepts semver with an optional prerelease', () => {
    expect(isValidVersion('1.0.0')).toBe(true);
    expect(isValidVersion('1.2.3-beta.1')).toBe(true);
    expect(VERSION_RE.test('10.20.30')).toBe(true);
  });

  it('rejects partial, prefixed or empty versions', () => {
    expect(isValidVersion('1.0')).toBe(false);
    expect(isValidVersion('v1.0.0')).toBe(false);
    expect(isValidVersion('')).toBe(false);
    expect(isValidVersion(undefined)).toBe(false);
    expect(isValidVersion('1.0.0 ')).toBe(false);
  });
});
