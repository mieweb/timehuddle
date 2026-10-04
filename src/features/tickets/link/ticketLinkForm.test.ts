import { describe, expect, it } from 'vitest';

import type { RedmineIssue } from '../../../lib/api';

import { EMPTY_LINK_FORM, linkFormFor, linkFormReady, linkKindOf } from './ticketLinkForm';

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
});

describe('linkFormReady', () => {
  it('needs nothing more for a TimeHuddle-only ticket', () => {
    expect(linkFormReady(EMPTY_LINK_FORM)).toBe(true);
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
