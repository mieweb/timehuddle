import { describe, expect, it } from 'vitest';

import type { SourceSearchAnswer, SourceSearchIssue } from '../../lib/api';

import { pickAssigned } from './assignedSources';

const issue = (id: number): SourceSearchIssue =>
  ({ id, subject: `Issue ${id}`, url: `https://x/issues/${id}`, tickets: [] }) as never;

const answer = (host: string, ids: number[], failed = false): SourceSearchAnswer => ({
  host,
  prefix: '',
  type: 'redmine',
  failed,
  issues: ids.map(issue),
});

describe('pickAssigned', () => {
  const answers = [
    answer('redmine1.example.com', [1, 2, 3, 4]),
    answer('github.com', [10, 11]),
    answer('down.example.com', [], true),
  ];

  it('takes up to the limit from each picked source, leaving the others out', () => {
    const picked = pickAssigned(answers, ['redmine1.example.com', 'github.com'], () => false, 3);
    expect(picked.map(({ host, issue }) => `${host}#${issue.id}`)).toEqual([
      'redmine1.example.com#1',
      'redmine1.example.com#2',
      'redmine1.example.com#3',
      'github.com#10',
      'github.com#11',
    ]);
    expect(pickAssigned(answers, ['github.com'], () => false)).toHaveLength(2);
  });

  it('skips issues already on the board, so the next ones come instead', () => {
    const picked = pickAssigned(answers, ['redmine1.example.com'], (i) => i.id <= 2, 2);
    expect(picked.map(({ issue }) => issue.id)).toEqual([3, 4]);
  });

  it('takes nothing from a source that failed to answer', () => {
    expect(pickAssigned(answers, ['down.example.com'], () => false)).toEqual([]);
  });
});
