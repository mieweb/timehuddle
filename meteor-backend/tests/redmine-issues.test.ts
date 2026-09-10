/**
 * Unit tests for redmine-issues (server/redmine-issues.js).
 *
 * These guard the read-only shape returned by `redmine.issues.list`:
 *   - only the bare-minimum fields we render are kept (no tracker/priority/etc.),
 *   - `{ id, name }` sub-objects are shaped, or null when absent,
 *   - a missing assignee becomes null (issue not assigned to anyone),
 *   - non-array input yields an empty list.
 */
import { describe, it, expect } from 'vitest';

import { toIssue, toIssueList } from '../server/redmine-issues';

const rawIssue = {
  id: 101,
  subject: 'Fix the thing',
  project: { id: 7, name: 'Platform' },
  status: { id: 2, name: 'In Progress' },
  assigned_to: { id: 42, name: 'Jane Doe' },
  // Fields we intentionally drop:
  tracker: { id: 1, name: 'Bug' },
  priority: { id: 4, name: 'High' },
  due_date: '2026-02-01',
  description: 'lots of text',
};

describe('redmine-issues toIssue', () => {
  it('maps only the minimal fields we render', () => {
    expect(toIssue(rawIssue)).toEqual({
      id: 101,
      subject: 'Fix the thing',
      project: { id: 7, name: 'Platform' },
      status: { id: 2, name: 'In Progress' },
      assignedTo: { id: 42, name: 'Jane Doe' },
    });
  });

  it('does not leak dropped fields', () => {
    const shaped = toIssue(rawIssue);
    expect('tracker' in shaped).toBe(false);
    expect('priority' in shaped).toBe(false);
    expect('due_date' in shaped).toBe(false);
    expect('description' in shaped).toBe(false);
  });

  it('returns null for a missing assignee', () => {
    const { assigned_to: _omit, ...unassigned } = rawIssue;
    expect(toIssue(unassigned).assignedTo).toBeNull();
  });

  it('tolerates missing project/status and empty subject', () => {
    expect(toIssue({ id: 5 })).toEqual({
      id: 5,
      subject: '',
      project: null,
      status: null,
      assignedTo: null,
    });
  });
});

describe('redmine-issues toIssueList', () => {
  it('shapes each issue in the array', () => {
    const list = toIssueList([rawIssue, { id: 5 }]);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(101);
    expect(list[1]).toEqual({
      id: 5,
      subject: '',
      project: null,
      status: null,
      assignedTo: null,
    });
  });

  it('returns an empty list for non-array input', () => {
    expect(toIssueList(undefined)).toEqual([]);
    expect(toIssueList(null)).toEqual([]);
    expect(toIssueList({})).toEqual([]);
  });
});
