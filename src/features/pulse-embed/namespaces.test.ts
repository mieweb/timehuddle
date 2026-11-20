import type { NamespaceInfo } from '@mieweb/pulse-embed';
import { describe, expect, it } from 'vitest';

import { PULSE_HOST_ID, STALE_NAMESPACE_MS, staleNamespaces } from './namespaces';

const NOW = Date.UTC(2026, 10, 19);
const DAY = 24 * 60 * 60 * 1000;

const ns = (namespace: string, extra: Partial<NamespaceInfo> = {}): NamespaceInfo => ({
  namespace,
  hostId: PULSE_HOST_ID,
  serverOrigin: 'https://timehuddle.example.org',
  bytes: 0,
  unsent: 0,
  lastUsedAt: NOW - 31 * DAY,
  active: false,
  ...extra,
});

describe('staleNamespaces (30-day rule, §6.4)', () => {
  it('purges an idle namespace with nothing unsent once 30 days have passed', () => {
    expect(staleNamespaces([ns('old')], NOW)).toEqual(['old']);
    expect(staleNamespaces([ns('edge', { lastUsedAt: NOW - STALE_NAMESPACE_MS })], NOW)).toEqual([
      'edge',
    ]);
  });

  it('keeps one used within 30 days', () => {
    expect(staleNamespaces([ns('recent', { lastUsedAt: NOW - 29 * DAY })], NOW)).toEqual([]);
    expect(
      staleNamespaces([ns('almost', { lastUsedAt: NOW - STALE_NAMESPACE_MS + 1 })], NOW),
    ).toEqual([]);
  });

  it('keeps one with unsent videos, however old', () => {
    expect(
      staleNamespaces([ns('unsent', { unsent: 1, lastUsedAt: NOW - 365 * DAY })], NOW),
    ).toEqual([]);
  });

  it('never purges the active namespace', () => {
    expect(staleNamespaces([ns('me', { active: true })], NOW)).toEqual([]);
  });

  it("leaves another app's namespaces alone", () => {
    expect(staleNamespaces([ns('other', { hostId: 'org.example.other' })], NOW)).toEqual([]);
  });

  it('keeps one whose last use it cannot read', () => {
    expect(staleNamespaces([ns('odd', { lastUsedAt: Number.NaN })], NOW)).toEqual([]);
  });

  it('picks only the stale ones from a mixed list', () => {
    expect(
      staleNamespaces(
        [
          ns('a'),
          ns('b', { active: true }),
          ns('c', { unsent: 2 }),
          ns('d', { lastUsedAt: NOW - DAY }),
          ns('e', { lastUsedAt: NOW - 90 * DAY }),
        ],
        NOW,
      ),
    ).toEqual(['a', 'e']);
  });
});
