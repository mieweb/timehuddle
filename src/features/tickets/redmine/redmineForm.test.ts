import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../lib/api';

import {
  UNASSIGNED,
  assigneeOptions,
  isStaleError,
  mismatchWarning,
  toId,
  toOptions,
} from './redmineForm';

const members = [
  { id: 8, name: 'Priya Patel' },
  { id: 9, name: 'Riley Okafor' },
];

describe('toOptions', () => {
  it('maps ids to string values', () => {
    expect(toOptions(members)).toEqual([
      { value: '8', label: 'Priya Patel' },
      { value: '9', label: 'Riley Okafor' },
    ]);
  });

  it('keeps a current value that is no longer in the list', () => {
    const options = toOptions(members, { id: 20, name: 'Developers' });
    expect(options[0]).toEqual({ value: '20', label: 'Developers' });
    expect(options).toHaveLength(3);
  });
});

describe('assigneeOptions', () => {
  it('offers unassigned, then me, then everyone else', () => {
    expect(assigneeOptions(members, 9).map((o) => o.label)).toEqual([
      'Unassigned',
      'Me (Riley Okafor)',
      'Priya Patel',
    ]);
  });

  it('does not list me twice when I am the current assignee', () => {
    const values = assigneeOptions(members, 8, { id: 8, name: 'Priya Patel' }).map((o) => o.value);
    expect(values).toEqual([UNASSIGNED, '8', '9']);
  });

  it('works when the caller is not a project member', () => {
    expect(assigneeOptions(members, 99).map((o) => o.value)).toEqual([UNASSIGNED, '8', '9']);
  });
});

describe('toId', () => {
  it('parses ids and maps the unassigned sentinel to null', () => {
    expect(toId('8')).toBe(8);
    expect(toId(UNASSIGNED)).toBeNull();
    expect(toId('')).toBeNull();
    expect(toId('abc')).toBeNull();
  });
});

describe('isStaleError', () => {
  it('recognizes only the stale code', () => {
    expect(isStaleError(new ApiError('changed', 500, 'stale'))).toBe(true);
    expect(isStaleError(new ApiError('nope', 500, 'no-permission'))).toBe(false);
    expect(isStaleError(new Error('stale'))).toBe(false);
  });
});

describe('mismatchWarning', () => {
  it('is null when everything was stored as sent', () => {
    expect(mismatchWarning([])).toBeNull();
  });

  it('names the fields in plain words', () => {
    expect(mismatchWarning(['status_id', 'assigned_to_id'])).toMatch(/status, assignee/);
  });
});
