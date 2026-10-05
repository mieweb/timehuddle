/**
 * Unit tests for ticket-link-core (server/ticket-link-core.js), #636.
 *
 * A ticket's link to a Redmine issue is shared by a team, so the rules that keep
 * two people from overwriting each other's change are pinned here.
 */
import { describe, it, expect } from 'vitest';

import {
  isHttpsUrl,
  linkAction,
  linkNotificationBody,
  linkedIssueIdOf,
  linkedTimeSummary,
  lockMessage,
  matchesExpectedLink,
  sessionIssuesAfterMove,
} from '../server/ticket-link-core';

const linked = { linkedIssue: { source: 'redmine', id: '482' } };
const unlinked = { title: 'No link' };

describe('linkedIssueIdOf', () => {
  it('reads the linked issue id, or null for an unlinked ticket', () => {
    expect(linkedIssueIdOf(linked)).toBe('482');
    expect(linkedIssueIdOf(unlinked)).toBeNull();
    expect(linkedIssueIdOf(null)).toBeNull();
  });
});

describe('matchesExpectedLink', () => {
  it('accepts a write made against the link that is still stored', () => {
    expect(matchesExpectedLink(linked, '482')).toBe(true);
    expect(matchesExpectedLink(unlinked, null)).toBe(true);
    expect(matchesExpectedLink(unlinked, undefined)).toBe(true);
  });

  it('refuses a write made against a link someone else has since changed', () => {
    expect(matchesExpectedLink(linked, null)).toBe(false);
    expect(matchesExpectedLink(linked, '500')).toBe(false);
    expect(matchesExpectedLink(unlinked, '482')).toBe(false);
  });

  it('compares a numeric expectation as the stored string', () => {
    expect(matchesExpectedLink(linked, 482)).toBe(true);
  });
});

describe('linkAction', () => {
  it('names the change for the activity log', () => {
    expect(linkAction(null, '482')).toBe('linked');
    expect(linkAction('482', '500')).toBe('relinked');
    expect(linkAction('482', null)).toBe('unlinked');
  });
});

describe('lockMessage', () => {
  const ada = { userId: 'u1', name: 'Ada' };
  const ben = { userId: 'u2', name: 'Ben' };
  const cy = { userId: 'u3', name: 'Cy' };

  it('names the teammate whose timer is running', () => {
    expect(lockMessage([ada], 'me')).toBe(
      'Ada is timing this ticket. The timer has to be stopped before it can be changed.',
    );
  });

  it('tells the caller when the timer is their own', () => {
    expect(lockMessage([ada], 'u1')).toBe(
      'You are timing this ticket. Stop your timer before it can be changed.',
    );
  });

  it('lists several people, the caller first', () => {
    expect(lockMessage([ada, ben], 'me')).toMatch(/^Ada and Ben are timing this ticket\./);
    expect(lockMessage([ada, ben, cy], 'u2')).toMatch(/^You, Ada and Cy are timing this ticket\./);
  });
});

describe('linkNotificationBody', () => {
  const base = { actorName: 'Priya', ticketTitle: 'Fix login' };

  it('says what happened to the ticket, naming issues by number only', () => {
    expect(linkNotificationBody({ ...base, action: 'linked', issueId: '482' })).toBe(
      'Priya linked "Fix login", a ticket you worked on, to Redmine #482',
    );
    expect(
      linkNotificationBody({ ...base, action: 'relinked', issueId: '500', previousIssueId: '482' }),
    ).toBe('Priya moved "Fix login", a ticket you worked on, from Redmine #482 to Redmine #500');
    expect(linkNotificationBody({ ...base, action: 'unlinked', previousIssueId: '482' })).toBe(
      'Priya unlinked "Fix login", a ticket you worked on, from Redmine #482',
    );
  });
});

describe('linkedTimeSummary', () => {
  const day = '2026-10-04';
  const session = (durationSeconds: number, redmineIssueId?: string, endTime: number | null = 1) => ({
    date: day,
    endTime,
    durationSeconds,
    ...(redmineIssueId ? { redmineIssueId } : {}),
  });
  const ledgerOf = (issueId: string, seconds: number, discardedSeconds = 0) =>
    new Map([[`${issueId}|${day}`, { seconds, discardedSeconds }]]);

  it('counts time logged before the ticket was linked as belonging to no issue', () => {
    expect(linkedTimeSummary({ sessions: [session(1800)], issueId: null })).toEqual({
      unlinkedSeconds: 1800,
      unsentSeconds: 0,
      sentSeconds: 0,
    });
  });

  it('splits time under the linked issue into sent and still to send', () => {
    const summary = linkedTimeSummary({
      sessions: [session(600), session(3600, '482'), session(1800, '482')],
      issueId: '482',
      poolTotals: [{ ticketId: '482', date: day, seconds: 5400 }],
      ledger: ledgerOf('482', 3600),
    });
    expect(summary).toEqual({ unlinkedSeconds: 600, unsentSeconds: 1800, sentSeconds: 3600 });
  });

  it('ignores time logged under an earlier link: it stays with that issue', () => {
    const summary = linkedTimeSummary({
      sessions: [session(3600, '482'), session(900, '500')],
      issueId: '500',
      poolTotals: [
        { ticketId: '482', date: day, seconds: 3600 },
        { ticketId: '500', date: day, seconds: 900 },
      ],
    });
    expect(summary).toEqual({ unlinkedSeconds: 0, unsentSeconds: 900, sentSeconds: 0 });
  });

  it('does not report "never send" time as sent, or a running timer as logged', () => {
    const summary = linkedTimeSummary({
      sessions: [session(1200, '482'), session(0, '482', null)],
      issueId: '482',
      poolTotals: [{ ticketId: '482', date: day, seconds: 1200 }],
      ledger: ledgerOf('482', 1200, 1200),
    });
    expect(summary).toEqual({ unlinkedSeconds: 0, unsentSeconds: 0, sentSeconds: 0 });
  });
});

describe('sessionIssuesAfterMove', () => {
  const day = '2026-10-04';
  const sent = (issueId: string, seconds = 600) => new Map([[`${issueId}|${day}`, { seconds }]]);
  const issuesOf = (input: Partial<Parameters<typeof sessionIssuesAfterMove>[0]>) =>
    sessionIssuesAfterMove({
      sessions: [],
      date: day,
      previousIssueId: null,
      nextIssueId: null,
      ledger: new Map(),
      ...input,
    }).map((row) => row.issueId);

  it('moves unsent sessions to the new ticket\u2019s issue', () => {
    const sessions = [{ _id: 'a', redmineIssueId: '700', date: day, endTime: 2 }, { _id: 'b', date: day, endTime: 2 }];
    expect(issuesOf({ sessions, nextIssueId: '900' })).toEqual(['900', '900']);
  });

  it('clears the issue when the new ticket is not linked', () => {
    const sessions = [{ _id: 'a', redmineIssueId: '700', date: day, endTime: 2 }];
    expect(issuesOf({ sessions })).toEqual([null]);
  });

  it('leaves a session on an issue-day that already has time sent', () => {
    const sessions = [
      { _id: 'a', redmineIssueId: '700', date: day, endTime: 2 },
      { _id: 'b', redmineIssueId: '700', date: '2026-10-03', endTime: 2 },
    ];
    expect(issuesOf({ sessions, nextIssueId: '900', ledger: sent('700') })).toEqual(['700', '900']);
  });

  it('always moves a session that is still running, since none of it can have been sent', () => {
    const sessions = [
      { _id: 'a', redmineIssueId: '700', date: day, endTime: 2 },
      { _id: 'b', redmineIssueId: '700', date: day, endTime: null },
    ];
    expect(issuesOf({ sessions, nextIssueId: '900', ledger: sent('700') })).toEqual(['700', '900']);
  });

  it('keeps a Redmine entry\u2019s sent time on its own issue, though its sessions carry no stamp', () => {
    const sessions = [{ _id: 'a', endTime: 2 }];
    expect(
      issuesOf({ sessions, previousIssueId: '700', nextIssueId: '900', ledger: sent('700') }),
    ).toEqual(['700']);
    expect(issuesOf({ sessions, previousIssueId: '700', nextIssueId: '900' })).toEqual(['900']);
  });
});

describe('isHttpsUrl', () => {
  it('accepts an absolute https link on any host', () => {
    expect(isHttpsUrl('https://github.com/mieweb/timehuddle/issues/636')).toBe(true);
    expect(isHttpsUrl('https://jira.example.com/browse/ABC-1')).toBe(true);
  });

  it('refuses everything that must not reach an href', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'http://github.com/a/b',
      'github.com/a/b',
      '',
      null,
      42,
    ]) {
      expect(isHttpsUrl(bad), String(bad)).toBe(false);
    }
  });
});
