import { describe, expect, it } from 'vitest';

import { toLinkedIssue } from './ticketLink';

describe('toLinkedIssue', () => {
  it('reads a stored Redmine link', () => {
    expect(toLinkedIssue({ source: 'redmine', id: '482' })).toEqual({
      source: 'redmine',
      id: '482',
    });
  });

  it('is null for an unlinked ticket', () => {
    expect(toLinkedIssue(undefined)).toBeNull();
    expect(toLinkedIssue(null)).toBeNull();
  });

  it('drops a link it does not understand rather than showing a broken one', () => {
    expect(toLinkedIssue({ source: 'jira', id: 'ABC-1' })).toBeNull();
    expect(toLinkedIssue({ source: 'redmine', id: '0' })).toBeNull();
    expect(toLinkedIssue({ source: 'redmine', id: 'abc' })).toBeNull();
    expect(toLinkedIssue({ source: 'redmine' })).toBeNull();
  });
});
