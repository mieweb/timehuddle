import { describe, expect, it } from 'vitest';

import { entryRefOf } from './redmineEntryRef';

const prefixes = [
  { host: 'redmine0.example.com', prefix: 'PM0' },
  { host: 'redmine1.example.com', prefix: 'PM1' },
];
const MAIN = 'https://redmine0.example.com';

describe('entryRefOf', () => {
  it('names an issue on the main Redmine by its prefix', () => {
    expect(entryRefOf('1', undefined, MAIN, prefixes)).toBe('PM0-1');
  });

  it("names another server's issue of the same number by that server's prefix", () => {
    expect(entryRefOf('1', 'redmine1.example.com', MAIN, prefixes)).toBe('PM1-1');
  });

  it('falls back to #1 on a server with no prefix, or before the main one is known', () => {
    expect(entryRefOf('1', 'other.example.com', MAIN, prefixes)).toBe('#1');
    expect(entryRefOf('1', undefined, null, prefixes)).toBe('#1');
  });
});
