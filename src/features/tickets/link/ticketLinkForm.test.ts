import { describe, expect, it } from 'vitest';

import type { RedmineIssue } from '../../../lib/api';

import {
  EMPTY_LINK_FORM,
  isHttpsUrl,
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
  it('starts the control on the ticket’s current link', () => {
    const form = linkFormFor({ github: 'https://github.com/a/b/issues/1', linkedIssue: null });
    expect(form).toMatchObject({ kind: 'github', github: 'https://github.com/a/b/issues/1' });
  });

  it('starts an unlinked ticket on Redmine, since "TimeHuddle" is not a link to add', () => {
    expect(linkFormFor({ github: '', linkedIssue: null }).kind).toBe('redmine');
  });
});

describe('linkFormReady', () => {
  it('needs nothing more for a TimeHuddle-only ticket', () => {
    expect(linkFormReady(EMPTY_LINK_FORM)).toBe(true);
  });

  it('only accepts an https link, since it is rendered as an href for the whole team', () => {
    const github = (value: string) => ({
      ...EMPTY_LINK_FORM,
      kind: 'github' as const,
      github: value,
    });
    expect(linkFormReady(github('https://tracker.example.com/issues/1'))).toBe(true);
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

  it('needs a link for GitHub', () => {
    expect(linkFormReady({ ...EMPTY_LINK_FORM, kind: 'github', github: '  ' })).toBe(false);
    expect(linkFormReady({ ...EMPTY_LINK_FORM, kind: 'github', github: 'https://x' })).toBe(true);
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
