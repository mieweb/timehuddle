/**
 * Unit tests for redmine-issues (server/redmine-issues.js).
 *
 * These guard the read-only shape returned by `redmine.issues.list`:
 *   - `{ id, name }` sub-objects are shaped, or null when absent,
 *   - a missing assignee becomes null (issue not assigned to anyone),
 *   - `status.isClosed` is preserved (it drives the Open/Closed tabs),
 *   - timestamps are normalized to ISO (they drive cross-source sorting),
 *   - fields we still drop (due_date, description, custom fields) stay dropped,
 *   - non-array input yields an empty list.
 */
import { describe, it, expect } from 'vitest';

import {
  toFormOptions,
  toIssue,
  toIssueDetail,
  toIssueList,
  toNamedList,
} from '../server/redmine-issues';

const rawIssue = {
  id: 101,
  subject: 'Fix the thing',
  project: { id: 7, name: 'Platform' },
  status: { id: 2, name: 'In Progress', is_closed: false },
  assigned_to: { id: 42, name: 'Jane Doe' },
  priority: { id: 4, name: 'High' },
  tracker: { id: 1, name: 'Bug' },
  created_on: '2026-01-15T09:30:00Z',
  updated_on: '2026-02-03T14:05:00Z',
  // Fields we intentionally drop:
  due_date: '2026-02-01',
  description: 'lots of text',
  custom_fields: [{ id: 1, name: 'Billable', value: '1' }],
};

const shapedIssue = {
  id: 101,
  subject: 'Fix the thing',
  project: { id: 7, name: 'Platform' },
  status: { id: 2, name: 'In Progress', isClosed: false },
  assignedTo: { id: 42, name: 'Jane Doe' },
  priority: { id: 4, name: 'High' },
  tracker: { id: 1, name: 'Bug' },
  createdAt: '2026-01-15T09:30:00.000Z',
  updatedAt: '2026-02-03T14:05:00.000Z',
};

const emptyIssue = {
  id: 5,
  subject: '',
  project: null,
  status: null,
  assignedTo: null,
  priority: null,
  tracker: null,
  createdAt: null,
  updatedAt: null,
};

describe('redmine-issues toIssue', () => {
  it('maps the fields the unified list renders', () => {
    expect(toIssue(rawIssue)).toEqual(shapedIssue);
  });

  it('does not leak dropped fields', () => {
    const shaped = toIssue(rawIssue);
    expect('due_date' in shaped).toBe(false);
    expect('description' in shaped).toBe(false);
    expect('custom_fields' in shaped).toBe(false);
  });

  it('returns null for a missing assignee', () => {
    const { assigned_to: _omit, ...unassigned } = rawIssue;
    expect(toIssue(unassigned).assignedTo).toBeNull();
  });

  it('preserves a closed status', () => {
    const closed = { ...rawIssue, status: { id: 5, name: 'Closed', is_closed: true } };
    expect(toIssue(closed).status).toEqual({ id: 5, name: 'Closed', isClosed: true });
  });

  it('treats a missing is_closed flag as open', () => {
    // Older Redmine versions omit `is_closed`; guessing from the status name
    // would misread instance-defined statuses.
    const legacy = { ...rawIssue, status: { id: 9, name: 'Resolved' } };
    expect(toIssue(legacy).status).toEqual({ id: 9, name: 'Resolved', isClosed: false });
  });

  it('normalizes timestamps to ISO and nulls unparseable ones', () => {
    expect(toIssue({ ...rawIssue, created_on: 'not-a-date' }).createdAt).toBeNull();
    expect(toIssue({ ...rawIssue, updated_on: undefined }).updatedAt).toBeNull();
  });

  it('tolerates an issue with nothing but an id', () => {
    expect(toIssue({ id: 5 })).toEqual(emptyIssue);
  });
});

describe('redmine-issues toIssueList', () => {
  it('shapes each issue in the array', () => {
    const list = toIssueList([rawIssue, { id: 5 }]);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual(shapedIssue);
    expect(list[1]).toEqual(emptyIssue);
  });

  it('returns an empty list for non-array input', () => {
    expect(toIssueList(undefined)).toEqual([]);
    expect(toIssueList(null)).toEqual([]);
    expect(toIssueList({})).toEqual([]);
  });
});

describe('redmine-issues toIssueDetail (M6)', () => {
  const rawDetail = {
    ...rawIssue,
    description: 'Line one\r\nLine two',
    author: { id: 8, name: 'Priya Patel' },
    allowed_statuses: [
      { id: 2, name: 'In Progress', is_closed: false },
      { id: 3, name: 'Resolved', is_closed: false },
      { id: 5, name: 'Closed', is_closed: true },
    ],
  };

  it('adds description, author and allowed statuses to the list DTO', () => {
    const detail = toIssueDetail(rawDetail);
    expect(detail).toMatchObject(shapedIssue);
    expect(detail.description).toBe('Line one\nLine two');
    expect(detail.author).toEqual({ id: 8, name: 'Priya Patel' });
  });

  it('lists the current status first and only once', () => {
    const ids = toIssueDetail(rawDetail).allowedStatuses.map((s: { id: number }) => s.id);
    expect(ids).toEqual([2, 3, 5]);
  });

  it('keeps the current status when Redmine omits it from the transitions', () => {
    const detail = toIssueDetail({ ...rawDetail, allowed_statuses: [{ id: 5, name: 'Closed', is_closed: true }] });
    expect(detail.allowedStatuses).toEqual([
      { id: 2, name: 'In Progress', isClosed: false },
      { id: 5, name: 'Closed', isClosed: true },
    ]);
  });

  it('tolerates an issue with no description, author or transitions', () => {
    const detail = toIssueDetail({ id: 5 });
    expect(detail.description).toBe('');
    expect(detail.author).toBeNull();
    expect(detail.allowedStatuses).toEqual([]);
  });

  it('leaves the list DTO lean', () => {
    expect('description' in toIssue(rawDetail)).toBe(false);
  });
});

describe('redmine-issues toFormOptions (M6)', () => {
  const options = toFormOptions({
    trackers: [{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }, { name: 'no id' }],
    memberships: [
      { id: 1, user: { id: 9, name: 'Zed Young' }, roles: [] },
      { id: 2, user: { id: 8, name: 'Priya Patel' }, roles: [] },
      { id: 3, user: { id: 8, name: 'Priya Patel' }, roles: [] },
      { id: 4, group: { id: 20, name: 'Developers' }, roles: [] },
    ],
    priorities: [
      { id: 1, name: 'Low', is_default: false },
      { id: 2, name: 'Normal', is_default: true },
    ],
  });

  it('keeps well-formed trackers', () => {
    expect(options.trackers).toEqual([
      { id: 1, name: 'Bug' },
      { id: 2, name: 'Feature' },
    ]);
  });

  it('offers each user once, sorted, and no groups', () => {
    expect(options.assignees).toEqual([
      { id: 8, name: 'Priya Patel' },
      { id: 9, name: 'Zed Young' },
    ]);
  });

  it("picks the instance's default priority", () => {
    expect(options.defaultPriorityId).toBe(2);
    expect(options.priorities[1]).toEqual({ id: 2, name: 'Normal', isDefault: true });
  });

  it('degrades to empty lists on malformed input', () => {
    expect(toFormOptions({ trackers: null, memberships: undefined, priorities: {} })).toEqual({
      trackers: [],
      assignees: [],
      priorities: [],
      defaultPriorityId: null,
    });
  });
});

describe('redmine-issues toNamedList (M6)', () => {
  it('shapes projects and drops malformed entries', () => {
    expect(toNamedList([{ id: 7, name: 'Platform' }, null, { name: 'x' }])).toEqual([
      { id: 7, name: 'Platform' },
    ]);
    expect(toNamedList('nope')).toEqual([]);
  });
});
