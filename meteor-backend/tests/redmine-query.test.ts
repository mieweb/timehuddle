/**
 * Unit tests for reading a search query (server/redmine-query.js).
 *
 * Two of these are security rules rather than parsing ones. A link to a different
 * Redmine must not be followed, because issue numbers mean different things on
 * different instances and following it would open an unrelated issue with a
 * straight face. And an `@name` that matches more than one colleague must resolve
 * to nobody, because guessing would show one person's work under another's name.
 */
import { describe, it, expect } from 'vitest';

import { MIN_QUERY_LENGTH, matchAssignees, parseRedmineQuery } from '../server/redmine-query';

const BASE = 'https://redmine.test';

describe('parseRedmineQuery', () => {
  it('reads an issue number, with or without the hash', () => {
    expect(parseRedmineQuery('#1234', BASE)).toEqual({ kind: 'id', value: 1234 });
    expect(parseRedmineQuery('1234', BASE)).toEqual({ kind: 'id', value: 1234 });
    expect(parseRedmineQuery('  #7  ', BASE)).toEqual({ kind: 'id', value: 7 });
  });

  it(`exempts an issue number from the ${MIN_QUERY_LENGTH}-character minimum`, () => {
    expect(parseRedmineQuery('7', BASE)).toEqual({ kind: 'id', value: 7 });
    expect(parseRedmineQuery('#7', BASE)).toEqual({ kind: 'id', value: 7 });
  });

  it('refuses a number that is not a Redmine id', () => {
    expect(parseRedmineQuery('0', BASE)).toEqual({ kind: 'text', value: null });
    expect(parseRedmineQuery('-3', BASE)).toEqual({ kind: 'text', value: null });
    expect(parseRedmineQuery('12.5', BASE)).toEqual({ kind: 'text', value: '12.5' });
  });

  it('takes the id out of a link to the user\'s own instance', () => {
    expect(parseRedmineQuery(`${BASE}/issues/1234`, BASE)).toEqual({ kind: 'url', value: 1234 });
    expect(parseRedmineQuery(`${BASE}/issues/1234/`, BASE)).toEqual({ kind: 'url', value: 1234 });
    expect(parseRedmineQuery(`${BASE}/issues/1234#note-3`, BASE)).toEqual({ kind: 'url', value: 1234 });
    expect(parseRedmineQuery(`${BASE}/issues/1234?tab=time_entries`, BASE)).toEqual({
      kind: 'url',
      value: 1234,
    });
  });

  it('honours a Redmine that lives under a sub-path', () => {
    const sub = 'http://localhost:3002/redmine';
    expect(parseRedmineQuery(`${sub}/issues/9`, sub)).toEqual({ kind: 'url', value: 9 });
    // Same host, but outside the Redmine install.
    expect(parseRedmineQuery('http://localhost:3002/issues/9', sub)).toEqual({ kind: 'url', value: null });
  });

  it('never follows a link to another instance', () => {
    for (const raw of [
      'https://other.example.org/issues/1234',
      'http://redmine.test/issues/1234', // different scheme, so a different origin
      'https://redmine.test.evil.example/issues/1234',
      'https://redmine.test:8443/issues/1234',
    ]) {
      expect(parseRedmineQuery(raw, BASE)).toEqual({ kind: 'url', value: null });
    }
  });

  it('reads a link that is not an issue link as nothing to ask', () => {
    expect(parseRedmineQuery(`${BASE}/projects/core`, BASE)).toEqual({ kind: 'url', value: null });
    expect(parseRedmineQuery(`${BASE}/issues`, BASE)).toEqual({ kind: 'url', value: null });
    expect(parseRedmineQuery('https://', BASE)).toEqual({ kind: 'url', value: null });
  });

  it('cannot read a link when the instance is unknown', () => {
    expect(parseRedmineQuery(`${BASE}/issues/1234`, null)).toEqual({ kind: 'url', value: null });
  });

  it('reads @name as an assignee query', () => {
    expect(parseRedmineQuery('@alex', BASE)).toEqual({ kind: 'assignee', value: 'alex' });
    expect(parseRedmineQuery('@Alex Kim', BASE)).toEqual({ kind: 'assignee', value: 'Alex Kim' });
  });

  it('reads plain words as a title search', () => {
    expect(parseRedmineQuery('login timeout', BASE)).toEqual({ kind: 'text', value: 'login timeout' });
  });

  it('asks nothing for a query under the minimum, but says how it read it', () => {
    expect(parseRedmineQuery('ab', BASE)).toEqual({ kind: 'text', value: null });
    expect(parseRedmineQuery('@a', BASE)).toEqual({ kind: 'assignee', value: null });
    expect(parseRedmineQuery('   ', BASE)).toEqual({ kind: 'text', value: null });
    expect(parseRedmineQuery('', BASE)).toEqual({ kind: 'text', value: null });
  });

  it('asks nothing for a bare @', () => {
    expect(parseRedmineQuery('@   ', BASE)).toEqual({ kind: 'assignee', value: null });
  });

  it('copes with input that is not a string', () => {
    for (const raw of [null, undefined, 42, {}, []]) {
      expect(parseRedmineQuery(raw as never, BASE)).toEqual({ kind: 'text', value: null });
    }
  });
});

describe('matchAssignees', () => {
  const users = [
    { id: 1, name: 'Alex Kim' },
    { id: 2, name: 'Alex Kimura' },
    { id: 3, name: 'Bo Chen' },
  ];

  it('matches on a first name, a surname or any part of either', () => {
    expect(matchAssignees(users, 'bo').map((u) => u.id)).toEqual([3]);
    expect(matchAssignees(users, 'chen').map((u) => u.id)).toEqual([3]);
    expect(matchAssignees(users, 'BO CHEN').map((u) => u.id)).toEqual([3]);
  });

  it('returns every candidate when a name is ambiguous, so the caller can ask', () => {
    expect(matchAssignees(users, 'alex').map((u) => u.id)).toEqual([1, 2]);
    expect(matchAssignees(users, 'kim').map((u) => u.id)).toEqual([1, 2]);
  });

  it('lets an exact name win outright over a longer one it is a prefix of', () => {
    expect(matchAssignees(users, 'Alex Kim').map((u) => u.id)).toEqual([1]);
    expect(matchAssignees(users, 'alex kim').map((u) => u.id)).toEqual([1]);
  });

  it('matches nobody for an unknown name, an empty one, or no roster', () => {
    expect(matchAssignees(users, 'zoe')).toEqual([]);
    expect(matchAssignees(users, '  ')).toEqual([]);
    expect(matchAssignees([], 'alex')).toEqual([]);
    expect(matchAssignees(null as never, 'alex')).toEqual([]);
  });
});
