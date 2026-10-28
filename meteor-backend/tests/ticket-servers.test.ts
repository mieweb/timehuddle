/**
 * The server registry (#734 step 5): what an org may register, how servers
 * named before types existed are typed when read.
 * No database, so these run in CI (vitest.unit.config.ts).
 */
import { describe, expect, it } from 'vitest';

import { normalizeSourcePrefixes, serverBaseUrlOf, typedServers } from '../server/ticket-ids';

describe('serverBaseUrlOf', () => {
  it('keeps the path a server lives under, and drops a trailing slash', () => {
    expect(serverBaseUrlOf('redmine.example.com')).toBe('https://redmine.example.com');
    expect(serverBaseUrlOf('https://Example.com/redmine/')).toBe('https://example.com/redmine');
  });

  it('takes https only, except on localhost', () => {
    expect(serverBaseUrlOf('http://redmine.example.com')).toBeNull();
    expect(serverBaseUrlOf('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('refuses credentials, queries and what is not an address', () => {
    expect(serverBaseUrlOf('https://me:pw@redmine.example.com')).toBeNull();
    expect(serverBaseUrlOf('https://redmine.example.com/?a=1')).toBeNull();
    expect(serverBaseUrlOf('not a server')).toBeNull();
  });
});

describe('normalizeSourcePrefixes', () => {
  it('stores each server with its type and address', () => {
    expect(
      normalizeSourcePrefixes([{ baseUrl: 'https://example.com/redmine/', prefix: 'pm' }], 'TH'),
    ).toEqual([
      { host: 'example.com', prefix: 'PM', type: 'redmine', baseUrl: 'https://example.com/redmine' },
    ]);
  });

  it('reads an entry saved before types existed as Redmine', () => {
    expect(normalizeSourcePrefixes([{ host: 'redmine.example.com', prefix: 'RM0' }], 'TH')).toEqual([
      { host: 'redmine.example.com', prefix: 'RM0', type: 'redmine', baseUrl: 'https://redmine.example.com' },
    ]);
  });

  it('refuses GitHub, which needs no setup', () => {
    expect(() => normalizeSourcePrefixes([{ host: 'github.com', prefix: 'GH' }], 'TH')).toThrow(
      /GitHub needs no setup/,
    );
  });

  it('refuses a type no owner can register', () => {
    expect(() =>
      normalizeSourcePrefixes([{ host: 'jira.example.com', prefix: 'J', type: 'jira' }], 'TH'),
    ).toThrow(/not a server type/);
  });
});

describe('typedServers', () => {
  const redmineBaseUrl = 'https://redmine0.example.com/redmine/';

  it('makes every untyped server Redmine, at the deployment address when it is that host', () => {
    expect(
      typedServers(
        [
          { host: 'redmine0.example.com', prefix: 'RM0' },
          { host: 'other.example.com', prefix: 'OT' },
        ],
        redmineBaseUrl,
      ),
    ).toEqual([
      { host: 'redmine0.example.com', prefix: 'RM0', type: 'redmine', baseUrl: 'https://redmine0.example.com/redmine' },
      { host: 'other.example.com', prefix: 'OT', type: 'redmine', baseUrl: 'https://other.example.com' },
    ]);
  });

  it('leaves out a GitHub row, which never did anything, and keeps typed servers as they are', () => {
    const typed = { host: 'a.example.com', prefix: 'A', type: 'redmine', baseUrl: 'https://a.example.com/x' };
    expect(typedServers([{ host: 'github.com', prefix: 'GH' }, typed], null)).toEqual([typed]);
  });
});
