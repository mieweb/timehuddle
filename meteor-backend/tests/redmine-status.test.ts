/**
 * Unit tests for redmine-status (server/redmine-status.js).
 *
 * These guard the client-facing shape of the Redmine connection status:
 *   - the encrypted API key is never leaked into the response,
 *   - `baseUrl` is derived from server config (passed in) not the stored row,
 *   - the display name falls back to the login when no first/last name exists.
 */
import { describe, it, expect } from 'vitest';

import { toStatus } from '../server/redmine-status';

const link = {
  userId: 'user-1',
  redmineUserId: 42,
  redmineLogin: 'jdoe',
  firstname: 'Jane',
  lastname: 'Doe',
  mail: 'jane@example.com',
  apiKey: 'iv:tag:cipher', // encrypted-at-rest payload — must never surface
  linkedAt: new Date('2026-01-02T03:04:05.000Z'),
};

describe('redmine-status toStatus', () => {
  it('reports not connected for a null link', () => {
    expect(toStatus(null)).toEqual({ connected: false });
  });

  it('never leaks the stored API key', () => {
    const status = toStatus(link, 'https://redmine.example.com');
    expect(JSON.stringify(status)).not.toContain('cipher');
    expect('apiKey' in status).toBe(false);
  });

  it('derives baseUrl from the passed server config, not the row', () => {
    const withStaleRow = { ...link, baseUrl: 'https://OLD.example.com' };
    const status = toStatus(withStaleRow, 'https://new.example.com');
    expect(status.baseUrl).toBe('https://new.example.com');
  });

  it('exposes the canonical identity fields', () => {
    const status = toStatus(link, 'https://redmine.example.com');
    expect(status).toMatchObject({
      connected: true,
      redmineUserId: 42,
      redmineLogin: 'jdoe',
      redmineName: 'Jane Doe',
      baseUrl: 'https://redmine.example.com',
      linkedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('falls back to the login when no name is set', () => {
    const nameless = { ...link, firstname: '', lastname: '' };
    expect(toStatus(nameless, 'https://redmine.example.com').redmineName).toBe('jdoe');
  });

  it('tolerates a missing server baseUrl', () => {
    expect(toStatus(link).baseUrl).toBeNull();
  });
});
