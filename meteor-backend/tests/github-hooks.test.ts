/** What GitHub's definition can't say as config (#734 step 4). */
import { describe, expect, it, vi } from 'vitest';

import { githubHooks, readQuery, searchScopes, toSlimIssue, withStatus } from '../server/sources/github-hooks';

describe('reading the search text', () => {
  it('takes an address, an ID, or words', () => {
    expect(readQuery('https://github.com/acme/pulse/pull/12')).toEqual({ container: 'acme/pulse', number: '12' });
    expect(readQuery('pulse-223')).toEqual({ repo: 'pulse', number: '223' });
    expect(readQuery('printer jams')).toEqual({ words: 'printer jams' });
  });

  it('asks nothing for a bare number, a name, or too little', () => {
    for (const query of ['223', '#223', '@ada', 'ab', 'https://example.com/x']) {
      expect(readQuery(query)).toBeNull();
    }
  });
});

describe('where a search looks', () => {
  it("is the member and who owns their repos, even an org they only collaborate in", () => {
    const repos = [{ owner: { login: 'acme' } }, { owner: { login: 'ada' } }, { owner: { login: 'acme' } }];
    expect(searchScopes('ada', repos)).toEqual(['user:ada', 'user:acme']);
  });
});

describe('a search result', () => {
  it('carries no body, and says when it is a pull request', () => {
    const slim = toSlimIssue({
      number: 7,
      title: 'Fix it',
      body: 'SECRET',
      html_url: 'https://github.com/acme/pulse/pull/7',
      repository_url: 'https://api.github.com/repos/acme/pulse',
      pull_request: {},
    });
    expect(slim).toMatchObject({ id: 7, ref: 'pulse-7', pull: true, subject: 'Fix it' });
    expect(JSON.stringify(slim)).not.toContain('SECRET');
  });
});

describe('an issue as the engine reads it', () => {
  it('has its state as a status, with both moves', () => {
    const issue = withStatus({ state: 'open', pull_request: {} });
    expect(issue.status).toEqual({ id: 'open', name: 'open' });
    expect(issue.allowed_statuses).toHaveLength(2);
    expect(issue.kind.name).toBe('Pull request');
  });
});

describe('writing back', () => {
  const raw = { url: 'https://api.github.com/repos/acme/pulse/issues/7' };

  it('sends only what changed, to the issue', async () => {
    const request = vi.fn(async () => ({ state: 'closed' }));
    const result = await githubHooks.githubWrite({ raw, edits: { status: 'closed' } }, { request });
    expect(request).toHaveBeenCalledWith('/repos/acme/pulse/issues/7', {
      method: 'PATCH',
      body: { state: 'closed' },
    });
    expect(result.mismatches).toEqual([]);
  });

  it('says what GitHub stored differently', async () => {
    const request = vi.fn(async () => ({ state: 'open', title: 'trimmed' }));
    const result = await githubHooks.githubWrite({ raw, edits: { title: 'sent' } }, { request });
    expect(result.mismatches).toEqual(['title']);
  });

  it('refuses a status GitHub has no such state for', async () => {
    await expect(
      githubHooks.githubWrite({ raw, edits: { status: 'done' } }, { request: vi.fn() }),
    ).rejects.toMatchObject({ code: 'bad-request' });
  });
});
