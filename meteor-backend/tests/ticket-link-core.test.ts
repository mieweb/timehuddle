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
  redmineLinkFor,
  sessionIssuesAfterMove,
  issueServerOf,
  onServer,
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

describe('redmineLinkFor (#736)', () => {
  it('names the server the issue is on', () => {
    expect(redmineLinkFor('482', 'redmine0.os.mieweb.org')).toEqual({
      source: 'redmine',
      id: '482',
      host: 'redmine0.os.mieweb.org',
    });
  });

  it('leaves the host out when Redmine has no address', () => {
    expect(redmineLinkFor('482', null)).toEqual({ source: 'redmine', id: '482' });
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
  const session = (
    durationSeconds: number,
    redmineIssueId?: string,
    endTime: number | null = 1,
  ) => ({
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
    const sessions = [
      { _id: 'a', redmineIssueId: '700', date: day, endTime: 2 },
      { _id: 'b', date: day, endTime: 2 },
    ];
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

describe('time on another server (#734 step 6)', () => {
  const MAIN = 'redmine0.example.com';
  const closed = (fields: Record<string, unknown>) => ({
    _id: 's',
    date: '2026-10-28',
    endTime: 2,
    durationSeconds: 600,
    ...fields,
  });

  it('names a carried issue\'s server only when it isn\'t the deployment\'s own', () => {
    expect(issueServerOf({ linkedIssue: { source: 'redmine', id: '233', host: MAIN } }, MAIN)).toBeNull();
    expect(issueServerOf({ linkedIssue: { source: 'redmine', id: '233' } }, MAIN)).toBeNull();
    expect(
      issueServerOf({ linkedIssue: { source: 'redmine', id: '233', host: 'other.example.com' } }, MAIN),
    ).toBe('other.example.com');
  });

  it('selects the deployment\'s own records as those with no host', () => {
    expect(onServer(null, 'host')).toEqual({ host: { $exists: false } });
    expect(onServer('other.example.com', 'redmineHost')).toEqual({ redmineHost: 'other.example.com' });
  });

  it('keeps the same issue number on two servers apart in the time at stake', () => {
    const sessions = [closed({ redmineIssueId: '233' }), closed({ redmineIssueId: '233', redmineHost: 'other.example.com' })];
    expect(linkedTimeSummary({ sessions, issueId: '233' }).unsentSeconds).toBe(600);
    expect(
      linkedTimeSummary({ sessions, issueId: '233', host: 'other.example.com' }).unsentSeconds,
    ).toBe(600);
  });

  it('moves a session to an issue on another server, with its host', () => {
    const moved = sessionIssuesAfterMove({
      sessions: [closed({})],
      date: '2026-10-28',
      previousIssueId: null,
      nextIssueId: '9',
      nextHost: 'other.example.com',
      ledger: new Map(),
    });
    expect(moved).toEqual([{ sessionId: 's', issueId: '9', host: 'other.example.com' }]);
  });

  it("keeps a session whose day was sent on another server, read against that server's ledger", () => {
    const session = closed({ redmineIssueId: '233', redmineHost: 'other.example.com' });
    const sentThere = new Map([['233|2026-10-28', { seconds: 600 }]]);
    const stays = sessionIssuesAfterMove({
      sessions: [session],
      date: '2026-10-28',
      previousIssueId: null,
      nextIssueId: '9',
      ledger: new Map(),
      otherLedgers: new Map([['other.example.com', sentThere]]),
    });
    expect(stays).toEqual([{ sessionId: 's', issueId: '233', host: 'other.example.com' }]);

    // The same day sent on the deployment's own Redmine says nothing about it.
    const follows = sessionIssuesAfterMove({
      sessions: [session],
      date: '2026-10-28',
      previousIssueId: null,
      nextIssueId: '9',
      ledger: sentThere,
    });
    expect(follows).toEqual([{ sessionId: 's', issueId: '9' }]);
  });
});
