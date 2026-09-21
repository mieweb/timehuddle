/**
 * Unit tests for redmine-issue-writes (server/redmine-issue-writes.js), M6.
 *
 * These pin the rules Redmine cannot enforce for us:
 *   - the create form is validated before any request,
 *   - an edit sends only the fields that changed (Redmine has no optimistic
 *     locking, so an untouched field would overwrite a concurrent edit),
 *   - a status outside the issue's allowed transitions is refused locally,
 *   - the read-back reports any field Redmine did not store as sent,
 *   - failures are named by HTTP status.
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_SUBJECT_LENGTH,
  buildUpdatePayload,
  readBackMismatches,
  validateCreateInput,
  writeFailureReason,
} from '../server/redmine-issue-writes';

const original = {
  id: 101,
  subject: 'Fix the thing',
  project: { id: 7, name: 'Platform' },
  status: { id: 2, name: 'In Progress', isClosed: false },
  assignedTo: { id: 8, name: 'Priya Patel' },
  priority: { id: 2, name: 'Normal' },
  tracker: { id: 1, name: 'Bug' },
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
  description: 'Steps to reproduce',
  author: { id: 8, name: 'Priya Patel' },
  allowedStatuses: [
    { id: 2, name: 'In Progress', isClosed: false },
    { id: 5, name: 'Closed', isClosed: true },
  ],
};

describe('validateCreateInput', () => {
  it('maps a full form onto Redmine field names', () => {
    expect(
      validateCreateInput({
        projectId: 7,
        trackerId: 1,
        subject: '  New bug  ',
        description: 'Details\r\nhere',
        assigneeId: 9,
        priorityId: 2,
      }),
    ).toEqual({
      fields: {
        project_id: 7,
        tracker_id: 1,
        subject: 'New bug',
        description: 'Details\nhere',
        assigned_to_id: 9,
        priority_id: 2,
      },
    });
  });

  it('omits optional fields left empty, so Redmine applies its defaults', () => {
    expect(validateCreateInput({ projectId: 7, subject: 'Minimal', assigneeId: null })).toEqual({
      fields: { project_id: 7, subject: 'Minimal' },
    });
  });

  it('requires a project and a subject', () => {
    expect(validateCreateInput({ subject: 'x' })).toEqual({ error: 'Choose a project.' });
    expect(validateCreateInput({ projectId: 7, subject: '   ' })).toEqual({
      error: 'A subject is required.',
    });
  });

  it('rejects an over-long subject and malformed ids', () => {
    const long = 'x'.repeat(MAX_SUBJECT_LENGTH + 1);
    expect(validateCreateInput({ projectId: 7, subject: long }).error).toMatch(/255/);
    expect(validateCreateInput({ projectId: 7, subject: 'ok', trackerId: '1' }).error).toBeTruthy();
    expect(validateCreateInput({ projectId: 7, subject: 'ok', assigneeId: -3 }).error).toBeTruthy();
  });
});

describe('buildUpdatePayload', () => {
  it('sends only the fields that changed', () => {
    expect(
      buildUpdatePayload(original, {
        statusId: 2, // unchanged
        priorityId: 3,
        assigneeId: 8, // unchanged
        description: 'Steps to reproduce', // unchanged
      }),
    ).toEqual({ fields: { priority_id: 3 } });
  });

  it('is a no-op when nothing changed', () => {
    expect(buildUpdatePayload(original, {})).toEqual({ fields: {} });
  });

  it('closes an issue through an allowed transition', () => {
    expect(buildUpdatePayload(original, { statusId: 5 })).toEqual({ fields: { status_id: 5 } });
  });

  it('refuses a status the workflow does not allow', () => {
    expect(buildUpdatePayload(original, { statusId: 3 }).error).toMatch(/isn't allowed/);
  });

  it('unassigns with the empty string Redmine expects', () => {
    expect(buildUpdatePayload(original, { assigneeId: null })).toEqual({
      fields: { assigned_to_id: '' },
    });
  });

  it('treats a CRLF-only difference in the description as unchanged', () => {
    const withCrlf = { ...original, description: 'a\nb' };
    expect(buildUpdatePayload(withCrlf, { description: 'a\r\nb' })).toEqual({ fields: {} });
  });

  it('rejects malformed edits', () => {
    expect(buildUpdatePayload(original, { priorityId: 'high' }).error).toBeTruthy();
    expect(buildUpdatePayload(original, { description: 42 }).error).toBeTruthy();
  });
});

describe('readBackMismatches', () => {
  it('is empty when Redmine stored what was sent', () => {
    const fresh = { ...original, priority: { id: 3, name: 'High' }, assignedTo: null };
    expect(readBackMismatches({ priority_id: 3, assigned_to_id: '' }, fresh)).toEqual([]);
  });

  it('names each field Redmine stored differently', () => {
    expect(readBackMismatches({ status_id: 5, priority_id: 3 }, original)).toEqual([
      'status_id',
      'priority_id',
    ]);
  });

  it('ignores trailing whitespace and CRLF in the description', () => {
    const fresh = { ...original, description: 'a\nb' };
    expect(readBackMismatches({ description: 'a\r\nb\n' }, fresh)).toEqual([]);
  });
});

describe('writeFailureReason', () => {
  it('names each failure by status', () => {
    expect(writeFailureReason({ status: 401 })).toBe('invalid-key');
    expect(writeFailureReason({ status: 403 })).toBe('no-permission');
    expect(writeFailureReason({ status: 404 })).toBe('gone');
    expect(writeFailureReason({ status: 422 })).toBe('rejected');
    expect(writeFailureReason({ status: 500 })).toBe('unreachable');
    expect(writeFailureReason(new Error('timeout'))).toBe('unreachable');
  });
});
