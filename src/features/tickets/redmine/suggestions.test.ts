import { describe, expect, it } from 'vitest';

import type { RedmineIssue, RedmineRelevantIssue } from '../../../lib/api';

import {
  emptySearchMessage,
  filterSuggestions,
  isCompleteQuery,
  liveReasons,
  newSearchResults,
  reasonLabel,
  shouldSearchServer,
} from './suggestions';

const issue = (id: number, over: Partial<RedmineIssue> = {}): RedmineIssue => ({
  id,
  subject: `Issue ${id}`,
  project: { id: 1, name: 'Core' },
  status: { id: 1, name: 'New', isClosed: false },
  assignedTo: null,
  priority: null,
  tracker: null,
  createdAt: null,
  updatedAt: null,
  ...over,
});

const relevant = (id: number, over: Partial<RedmineRelevantIssue> = {}): RedmineRelevantIssue => ({
  ...issue(id),
  reasons: ['assigned'],
  score: 60,
  ...over,
});

describe('shouldSearchServer', () => {
  it('always searches an issue number or a pasted link', () => {
    for (const query of ['7', '#7', '1234', 'https://redmine.test/issues/7']) {
      expect(shouldSearchServer(query)).toBe(true);
    }
  });

  it('waits for three characters of words or a name', () => {
    expect(shouldSearchServer('lo')).toBe(false);
    expect(shouldSearchServer('@a')).toBe(false);
    expect(shouldSearchServer('log')).toBe(true);
    expect(shouldSearchServer('@al')).toBe(true);
  });

  it('never searches an empty query, or a bare #', () => {
    expect(shouldSearchServer('   ')).toBe(false);
    expect(shouldSearchServer('#')).toBe(false);
  });
});

describe('isCompleteQuery', () => {
  it('skips the typing pause only for numbers and links', () => {
    expect(isCompleteQuery('#42')).toBe(true);
    expect(isCompleteQuery('https://redmine.test/issues/42')).toBe(true);
    expect(isCompleteQuery('login')).toBe(false);
  });
});

describe('filterSuggestions', () => {
  const BASE = 'https://redmine.test';
  const issues = [
    issue(12, { subject: 'Login timeout', assignedTo: { id: 5, name: 'Alex Kim' } }),
    issue(120, { subject: 'Invoice export', project: { id: 2, name: 'Billing' } }),
    issue(31, { subject: 'Dark mode', assignedTo: { id: 6, name: 'Priya Patel' } }),
  ];
  const ids = (list: RedmineIssue[]) => list.map((row) => row.id);

  it('keeps everything, in order, for an empty query', () => {
    expect(ids(filterSuggestions(issues, '  ', BASE))).toEqual([12, 120, 31]);
  });

  it('matches issue numbers by prefix, with or without #', () => {
    expect(ids(filterSuggestions(issues, '#12', BASE))).toEqual([12, 120]);
    expect(ids(filterSuggestions(issues, '3', BASE))).toEqual([31]);
  });

  it('matches a pasted link to that one issue', () => {
    expect(ids(filterSuggestions(issues, 'https://redmine.test/issues/120', BASE))).toEqual([120]);
    expect(ids(filterSuggestions(issues, 'https://redmine.test/projects/x', BASE))).toEqual([]);
  });

  it('leaves a link on another instance, or with no instance known, to the server', () => {
    expect(ids(filterSuggestions(issues, 'https://other.test/issues/120', BASE))).toEqual([]);
    expect(ids(filterSuggestions(issues, 'https://redmine.test/sub/issues/120', BASE))).toEqual([]);
    expect(ids(filterSuggestions(issues, 'https://redmine.test/issues/120', null))).toEqual([]);
  });

  it('honours an instance on a sub-path', () => {
    const base = 'https://example.test/redmine/';
    expect(ids(filterSuggestions(issues, 'https://example.test/redmine/issues/31', base))).toEqual([
      31,
    ]);
  });

  it('matches @name against the assignee only', () => {
    expect(ids(filterSuggestions(issues, '@pri', BASE))).toEqual([31]);
    expect(ids(filterSuggestions(issues, '@', BASE))).toEqual([12, 31]);
  });

  it('matches words against title, project and assignee, ignoring case', () => {
    expect(ids(filterSuggestions(issues, 'LOGIN', BASE))).toEqual([12]);
    expect(ids(filterSuggestions(issues, 'billing', BASE))).toEqual([120]);
    expect(ids(filterSuggestions(issues, 'alex', BASE))).toEqual([12]);
  });
});

describe('newSearchResults', () => {
  it('leaves out issues already in the table or the suggestions', () => {
    const results = [issue(1), issue(2), issue(3)];
    expect(newSearchResults(results, new Set([2])).map((row) => row.id)).toEqual([1, 3]);
  });
});

describe('emptySearchMessage', () => {
  it('words the message by how the server read the query', () => {
    expect(emptySearchMessage('id', '#99')).toContain('#99');
    expect(emptySearchMessage('url', 'https://x.test/issues/1')).toMatch(/link/);
    expect(emptySearchMessage('assignee', '@al')).toContain('@al');
    expect(emptySearchMessage('text', 'printer')).toContain('printer');
  });
});

describe('reasonLabel', () => {
  const NOW = new Date(2026, 8, 25, 15, 0).getTime();

  it('shows the strongest reason, which the server sends first', () => {
    expect(reasonLabel(relevant(1, { reasons: ['assigned', 'watching'] }), { now: NOW })).toBe(
      'Assigned',
    );
    expect(
      reasonLabel(relevant(1, { reasons: ['running'] }), { now: NOW, runningIssueId: 1 }),
    ).toBe('Timer running');
  });

  it('says how long ago time was logged, in calendar days', () => {
    const twoDaysAgo = new Date(2026, 8, 23, 23, 30).toISOString();
    expect(
      reasonLabel(relevant(1, { reasons: ['logged'], lastTimeLoggedAt: twoDaysAgo }), {
        now: NOW,
        locale: 'en',
      }),
    ).toBe('Logged 2 days ago');

    const yesterday = new Date(2026, 8, 24, 9, 0).toISOString();
    expect(
      reasonLabel(relevant(1, { reasons: ['logged'], lastTimeLoggedAt: yesterday }), {
        now: NOW,
        locale: 'en',
      }),
    ).toBe('Logged yesterday');
  });

  it('falls back when the logged date is missing, and shows nothing without a reason', () => {
    expect(reasonLabel(relevant(1, { reasons: ['logged'] }), { now: NOW })).toBe('Logged recently');
    expect(reasonLabel(relevant(1, { reasons: [] }), { now: NOW })).toBeNull();
    const withoutReasons = { ...issue(1) } as unknown as RedmineRelevantIssue;
    expect(reasonLabel(withoutReasons, { now: NOW })).toBeNull();
  });
});

describe('liveReasons', () => {
  it('drops a stale "running" once the timer has stopped', () => {
    expect(liveReasons(relevant(1, { reasons: ['running', 'assigned'] }), null)).toEqual([
      'assigned',
    ]);
  });

  it('puts "running" first on the issue being timed, even before the server knows', () => {
    expect(liveReasons(relevant(1, { reasons: ['watching'] }), 1)).toEqual(['running', 'watching']);
    expect(liveReasons(relevant(1, { reasons: ['running'] }), 1)).toEqual(['running']);
  });

  it('leaves other issues alone', () => {
    expect(liveReasons(relevant(2, { reasons: ['assigned'] }), 1)).toEqual(['assigned']);
  });
});
