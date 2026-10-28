import { describe, expect, it } from 'vitest';

import { isGithubIssueUrl, parseGithubIssueUrl } from './githubIssue';

describe('parseGithubIssueUrl', () => {
  it('reads an issue or a pull request, with anything after its number', () => {
    expect(parseGithubIssueUrl('https://github.com/mieweb/timehuddle/issues/223')).toEqual({
      owner: 'mieweb',
      repo: 'timehuddle',
      number: '223',
    });
    expect(parseGithubIssueUrl('https://github.com/mieweb/pulse/pull/554/files#diff')).toEqual({
      owner: 'mieweb',
      repo: 'pulse',
      number: '554',
    });
  });

  it('takes a pasted address without https://, and around spaces', () => {
    expect(parseGithubIssueUrl('  github.com/mieweb/timehuddle/issues/223 ')).toEqual({
      owner: 'mieweb',
      repo: 'timehuddle',
      number: '223',
    });
    expect(isGithubIssueUrl('www.github.com/mieweb/pulse/pull/9')).toBe(true);
  });

  it('reads nothing that is not a GitHub issue or pull request', () => {
    expect(parseGithubIssueUrl('https://github.com/mieweb/timehuddle')).toBeNull();
    expect(parseGithubIssueUrl('https://notgithub.com/mieweb/timehuddle/issues/1')).toBeNull();
    expect(parseGithubIssueUrl('see the doc')).toBeNull();
    expect(isGithubIssueUrl('')).toBe(false);
  });
});
