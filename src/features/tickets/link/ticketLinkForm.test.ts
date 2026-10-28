import { describe, expect, it } from 'vitest';

import type { RedmineIssue } from '../../../lib/api';

import {
  EMPTY_LINK_FORM,
  convertibleIdOf,
  isHttpsUrl,
  isRedmineIssueUrl,
  isWebUrl,
  linkFormFor,
  linkFormReady,
  linkKindOf,
} from './ticketLinkForm';

const issue = { id: 482, subject: 'Export job times out' } as RedmineIssue;

describe('linkKindOf', () => {
  it('reads what a ticket is tracked in from its one link', () => {
    expect(linkKindOf({ github: '', linkedIssue: null })).toBe('none');
    expect(linkKindOf({ github: 'https://github.com/a/b/issues/1', linkedIssue: null })).toBe(
      'github',
    );
    expect(linkKindOf({ github: '', linkedIssue: { source: 'redmine', id: '482' } })).toBe(
      'redmine',
    );
  });
});

describe('linkFormFor', () => {
  const url = 'https://github.com/a/b/issues/1';

  it('starts the control on the ticket’s current link, and whether it was converted', () => {
    expect(linkFormFor({ github: url, linkIsIssue: false, linkedIssue: null })).toMatchObject({
      kind: 'github',
      github: url,
      linkIsIssue: false,
    });
  });

  it('keeps a link saved before the choice existed converted, as it has always shown', () => {
    expect(linkFormFor({ github: url, linkIsIssue: null, linkedIssue: null }).linkIsIssue).toBe(
      true,
    );
  });

  it('starts an unlinked ticket on the link field, and a Redmine-linked one on Redmine', () => {
    expect(linkFormFor({ github: '', linkIsIssue: null, linkedIssue: null }).kind).toBe('github');
    expect(
      linkFormFor({
        github: '',
        linkIsIssue: null,
        linkedIssue: { source: 'redmine', id: '482' },
      }).kind,
    ).toBe('redmine');
  });
});

describe('convertibleIdOf', () => {
  const servers = [{ host: 'redmine.example.com', prefix: 'PM' }];

  it('names a GitHub issue or pull request by its repo, and a server’s issue by its prefix', () => {
    expect(convertibleIdOf('https://github.com/mieweb/pulse/issues/250', servers)).toBe(
      'pulse-250',
    );
    expect(convertibleIdOf(' https://github.com/mieweb/pulse/pull/554 ', servers)).toBe(
      'pulse-554',
    );
    expect(convertibleIdOf('https://redmine.example.com/issues/233', servers)).toBe('PM-233');
  });

  it('offers nothing for any other link, or one that is not https', () => {
    expect(convertibleIdOf('https://docs.google.com/document/d/abc/edit', servers)).toBeNull();
    expect(convertibleIdOf('https://other.example.com/issues/233', servers)).toBeNull();
    expect(convertibleIdOf('http://github.com/mieweb/pulse/issues/250', servers)).toBeNull();
  });
});

describe('linkFormReady', () => {
  it('takes no link for a new ticket, but not when changing one, where that is Unlink', () => {
    expect(linkFormReady(EMPTY_LINK_FORM)).toBe(true);
    expect(linkFormReady(EMPTY_LINK_FORM, { allowNone: false })).toBe(false);
  });

  it('only accepts an https link, since it is rendered as an href for the whole team', () => {
    const github = (value: string) => ({
      ...EMPTY_LINK_FORM,
      kind: 'github' as const,
      github: value,
    });
    // Any host: a doc or a folder is as good a link as an issue.
    for (const good of [
      'https://tracker.example.com/issues/1',
      'https://github.com/a/b',
      'https://docs.google.com/document/d/abc/edit',
      ' https://github.com/mieweb/pulse/pull/554/files ',
    ]) {
      expect(linkFormReady(github(good)), good).toBe(true);
    }
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'http://github.com/a/b',
      'github.com/a/b',
      'not a link',
    ]) {
      expect(linkFormReady(github(bad)), bad).toBe(false);
    }
  });

  it('reads a blank link as no link', () => {
    expect(linkFormReady({ ...EMPTY_LINK_FORM, github: '  ' })).toBe(true);
    expect(linkFormReady({ ...EMPTY_LINK_FORM, github: '  ' }, { allowNone: false })).toBe(false);
    expect(linkFormReady({ ...EMPTY_LINK_FORM, github: 'https://x' })).toBe(true);
  });

  it('needs a found issue to link an existing Redmine issue', () => {
    const form = { ...EMPTY_LINK_FORM, kind: 'redmine' as const, query: '#482' };
    expect(linkFormReady(form)).toBe(false);
    expect(linkFormReady({ ...form, issue })).toBe(true);
  });

  it('needs only a project to create a new Redmine issue', () => {
    const form = { ...EMPTY_LINK_FORM, kind: 'redmine' as const, redmineMode: 'new' as const };
    expect(linkFormReady(form)).toBe(false);
    expect(linkFormReady({ ...form, projectId: '2' })).toBe(true);
  });
});

describe('isRedmineIssueUrl', () => {
  const base = 'https://redmine0.example.com';

  it("takes an issue on this TimeHuddle's Redmine, at its root or under a path", () => {
    expect(isRedmineIssueUrl('https://redmine0.example.com/issues/214', base)).toBe(true);
    expect(isRedmineIssueUrl('https://redmine0.example.com/redmine/issues/214/', base)).toBe(true);
  });

  it('refuses another host, a page that is not an issue, and no Redmine at all', () => {
    expect(isRedmineIssueUrl('https://other.example.com/issues/214', base)).toBe(false);
    expect(isRedmineIssueUrl('https://redmine0.example.com/projects/web', base)).toBe(false);
    expect(isRedmineIssueUrl('https://redmine0.example.com/issues/214', null)).toBe(false);
  });
});

describe('isHttpsUrl / isWebUrl', () => {
  it('saves https only, on any host', () => {
    expect(isHttpsUrl(' https://github.com/a/b/issues/1 ')).toBe(true);
    expect(isHttpsUrl('https://jira.example.com/browse/ABC-1')).toBe(true);
    expect(isHttpsUrl('http://github.com/a/b')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
  });

  it('still renders an http link saved before the rule, but never a script or data URL', () => {
    expect(isWebUrl('http://old.example.com/1')).toBe(true);
    expect(isWebUrl('https://github.com/a/b')).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isWebUrl('plain text')).toBe(false);
  });
});
