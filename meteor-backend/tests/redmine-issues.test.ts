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
 *
 * MVP2 A4 turns the "fields we drop" line into a data-minimisation guard. `toIssue`
 * is the one shape every list and search response is built from, so an exhaustive
 * key assertion here is what stops a future field addition quietly putting an
 * issue description — which on the enterprise instance may hold PHI — on the wire.
 */
import { describe, it, expect } from 'vitest';

import {
  toFormOptions,
  toIssue,
  toIssueDetail,
  toIssueList,
  toJournals,
  toNameMap,
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

describe('redmine-issues toJournals (M6 issue page)', () => {
  const lookups = {
    statuses: toNameMap([
      { id: 1, name: 'New' },
      { id: 5, name: 'Closed' },
    ]),
    priorities: toNameMap([
      { id: 2, name: 'Normal' },
      { id: 3, name: 'High' },
    ]),
    users: toNameMap([{ id: 8, name: 'Priya Patel' }]),
  };

  it('names status, priority and assignee ids', () => {
    const [journal] = toJournals(
      [
        {
          id: 11,
          user: { id: 8, name: 'Priya Patel' },
          created_on: '2026-09-21T10:00:00Z',
          notes: '',
          details: [
            { property: 'attr', name: 'status_id', old_value: '1', new_value: '5' },
            { property: 'attr', name: 'priority_id', old_value: '2', new_value: '3' },
            { property: 'attr', name: 'assigned_to_id', old_value: null, new_value: '8' },
          ],
        },
      ],
      lookups,
    );
    expect(journal).toEqual({
      id: 11,
      user: { id: 8, name: 'Priya Patel' },
      createdAt: '2026-09-21T10:00:00.000Z',
      notes: '',
      changes: [
        { field: 'status', from: 'New', to: 'Closed' },
        { field: 'priority', from: 'Normal', to: 'High' },
        { field: 'assignee', from: null, to: 'Priya Patel' },
      ],
    });
  });

  it('falls back to #id for an id it cannot name', () => {
    const [journal] = toJournals(
      [{ id: 1, details: [{ property: 'attr', name: 'assigned_to_id', old_value: '99', new_value: '' }] }],
      lookups,
    );
    expect(journal.changes).toEqual([{ field: 'assignee', from: '#99', to: null }]);
  });

  it('keeps comments, hides description text, and names other kinds of change', () => {
    const journals = toJournals([
      { id: 1, notes: 'Looks good\r\nto me', details: [] },
      { id: 2, details: [{ property: 'attr', name: 'description', old_value: 'a', new_value: 'b' }] },
      { id: 3, details: [{ property: 'cf', name: '4', old_value: '', new_value: 'x' }] },
      { id: 4, details: [{ property: 'attr', name: 'due_date', old_value: null, new_value: '2026-10-01' }] },
    ]);
    expect(journals.map((j) => [j.notes, j.changes])).toEqual([
      ['Looks good\nto me', []],
      ['', [{ field: 'description', from: null, to: null }]],
      ['', [{ field: 'custom field', from: null, to: null }]],
      ['', [{ field: 'due date', from: null, to: null }]],
    ]);
  });

  it('drops empty journals and tolerates malformed input', () => {
    expect(toJournals([{ id: 1, notes: '', details: [] }, null, { notes: 'no id' }])).toEqual([]);
    expect(toJournals(undefined)).toEqual([]);
  });
});

describe('data minimisation (MVP2 A4)', () => {
  /** Every key a `SlimIssue` may have. Adding one here is a deliberate decision. */
  const SLIM_KEYS = [
    'assignedTo',
    'createdAt',
    'id',
    'priority',
    'project',
    'status',
    'subject',
    'tracker',
    'updatedAt',
  ];

  it('emits exactly the slim keys and no others', () => {
    expect(Object.keys(toIssue(rawIssue)).sort()).toEqual(SLIM_KEYS);
  });

  it('drops description, journals and custom fields however they arrive', () => {
    const loaded = toIssue({
      ...rawIssue,
      description: 'Patient Jane Doe reports…',
      journals: [{ id: 1, notes: 'Patient Jane Doe reports…' }],
      custom_fields: [{ id: 9, name: 'Diagnosis', value: 'confidential' }],
      attachments: [{ id: 3, filename: 'scan.pdf' }],
      watchers: [{ id: 4, name: 'Someone' }],
    });

    expect(Object.keys(loaded).sort()).toEqual(SLIM_KEYS);
    for (const banned of ['description', 'journals', 'custom_fields', 'attachments', 'watchers']) {
      expect(loaded).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(loaded)).not.toContain('Patient');
    expect(JSON.stringify(loaded)).not.toContain('confidential');
  });

  it('holds for every issue in a list, not just a shaped example', () => {
    const list = toIssueList([rawIssue, { ...rawIssue, id: 102, description: 'more text' }]);
    for (const issue of list) {
      expect(Object.keys(issue).sort()).toEqual(SLIM_KEYS);
    }
  });
});
