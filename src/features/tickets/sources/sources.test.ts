/**
 * Unit tests for the source adapters' normalization.
 *
 * These guard the facts the unified list depends on: composite row keys, the
 * cross-source `isClosed` and priority `rank` mappings, per-source id
 * namespacing, and external links.
 */
import { describe, it, expect } from 'vitest';

import type { RedmineIssue, Ticket } from '../../../lib/api';

import { huddleSource } from './huddleSource';
import { redmineSource, type RedmineRaw } from './redmineSource';
import type { TicketSourceContext } from './types';

const ctx: TicketSourceContext = {
  userId: 'u1',
  teams: [
    { id: 'team-1', name: 'Platform' },
    { id: 'team-2', name: 'Mobile' },
  ],
  resolveMemberName: (id) => (id === 'u1' ? 'Ada Lovelace' : null),
  redmineScope: 'mine',
};

const huddleTicket: Ticket = {
  id: 't1',
  teamId: 'team-1',
  title: 'Fix the thing',
  description: null,
  github: '',
  status: 'in-progress',
  priority: 'high',
  createdBy: 'u1',
  assignedTo: ['u1', 'u9'],
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

const redmineIssue: RedmineIssue = {
  id: 101,
  subject: 'Fix the other thing',
  project: { id: 7, name: 'Platform' },
  status: { id: 2, name: 'In Progress', isClosed: false },
  assignedTo: { id: 42, name: 'Jane Doe' },
  priority: { id: 4, name: 'High' },
  tracker: { id: 1, name: 'Bug' },
  createdAt: '2026-01-15T09:30:00.000Z',
  updatedAt: '2026-02-03T14:05:00.000Z',
};

const raw: RedmineRaw = { issue: redmineIssue, baseUrl: 'https://redmine.example.com' };

describe('huddleSource.toUnified', () => {
  it('normalizes a ticket', () => {
    expect(huddleSource.toUnified(huddleTicket, ctx)).toEqual({
      key: 'huddle:t1',
      sourceId: 'huddle',
      id: 't1',
      ref: '#t1',
      title: 'Fix the thing',
      container: { id: 'team-1', name: 'Platform' },
      status: { native: 'in-progress', isClosed: false },
      priority: { native: 'high', rank: 3 },
      assignees: [
        { id: 'u1', name: 'Ada Lovelace' },
        // Falls back to the raw id when the member is not in any loaded team.
        { id: 'u9', name: 'u9' },
      ],
      createdBy: { id: 'u1', name: 'Ada Lovelace' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      externalUrl: null,
      externalRef: null,
      sharedWithTimeharbor: false,
      capabilities: huddleSource.capabilities,
    });
  });

  it('labels a GitHub link and leaves other links generic', () => {
    const gh = huddleSource.toUnified(
      { ...huddleTicket, github: 'https://github.com/o/r/issues/1' },
      ctx,
    );
    expect(gh.externalRef).toEqual({
      url: 'https://github.com/o/r/issues/1',
      label: 'GitHub',
    });

    const other = huddleSource.toUnified({ ...huddleTicket, github: 'https://x.dev/i/2' }, ctx);
    expect(other.externalRef?.label).toBe('Issue link');
  });

  it.each([
    ['closed', true],
    ['reviewed', true],
    ['open', false],
    ['blocked', false],
  ])('maps status %s to isClosed=%s', (status, isClosed) => {
    expect(huddleSource.toUnified({ ...huddleTicket, status }, ctx).status).toEqual({
      native: status,
      isClosed,
    });
  });

  it('defaults a blank status to open', () => {
    expect(huddleSource.toUnified({ ...huddleTicket, status: '' }, ctx).status.native).toBe('open');
  });

  it('yields a null priority when none is set', () => {
    expect(huddleSource.toUnified({ ...huddleTicket, priority: null }, ctx).priority).toBeNull();
  });

  it('yields a null container for a team the user is not in', () => {
    expect(huddleSource.toUnified({ ...huddleTicket, teamId: 'gone' }, ctx).container).toBeNull();
  });

  it('is unavailable with no teams', () => {
    expect(huddleSource.isAvailable({ ...ctx, teams: [] })).toBe(false);
    expect(huddleSource.isAvailable(ctx)).toBe(true);
  });
});

describe('redmineSource.toUnified', () => {
  it('normalizes an issue', () => {
    expect(redmineSource.toUnified(raw, ctx)).toEqual({
      key: 'redmine:101',
      sourceId: 'redmine',
      id: '101',
      ref: '#101',
      title: 'Fix the other thing',
      container: { id: '7', name: 'Platform' },
      status: { native: 'In Progress', isClosed: false },
      priority: { native: 'High', rank: 3 },
      assignees: [{ id: '42', name: 'Jane Doe' }],
      createdBy: null,
      createdAt: '2026-01-15T09:30:00.000Z',
      updatedAt: '2026-02-03T14:05:00.000Z',
      externalUrl: 'https://redmine.example.com/issues/101',
      externalRef: null,
      sharedWithTimeharbor: false,
      capabilities: redmineSource.capabilities,
    });
  });

  it('carries Redmine\u2019s own isClosed flag', () => {
    const closed = {
      ...raw,
      issue: { ...redmineIssue, status: { id: 5, name: 'Rejected', isClosed: true } },
    };
    expect(redmineSource.toUnified(closed, ctx).status).toEqual({
      native: 'Rejected',
      isClosed: true,
    });
  });

  it('ranks an unrecognized priority 0 rather than dropping it', () => {
    const custom = {
      ...raw,
      issue: { ...redmineIssue, priority: { id: 9, name: 'Whenever' } },
    };
    expect(redmineSource.toUnified(custom, ctx).priority).toEqual({
      native: 'Whenever',
      rank: 0,
    });
  });

  it('has no external link without a base URL', () => {
    expect(redmineSource.toUnified({ ...raw, baseUrl: null }, ctx).externalUrl).toBeNull();
  });

  it('tolerates a missing status, project and assignee', () => {
    const bare = {
      ...raw,
      issue: { ...redmineIssue, status: null, project: null, assignedTo: null, priority: null },
    };
    const unified = redmineSource.toUnified(bare, ctx);
    expect(unified.status).toEqual({ native: 'Unknown', isClosed: false });
    expect(unified.container).toBeNull();
    expect(unified.assignees).toEqual([]);
    expect(unified.priority).toBeNull();
  });

  it('can be edited but never deleted from TimeHuddle (M6)', () => {
    expect(redmineSource.capabilities).toMatchObject({
      edit: true,
      delete: false,
      assign: true,
      changeStatus: true,
      openExternal: true,
    });
  });
});

describe('source id namespacing', () => {
  it('keeps colliding native ids distinct across sources', () => {
    const huddle = huddleSource.toUnified({ ...huddleTicket, id: '101' }, ctx);
    const redmine = redmineSource.toUnified(raw, ctx);
    expect(huddle.id).toBe(redmine.id);
    expect(huddle.key).not.toBe(redmine.key);
  });
});
