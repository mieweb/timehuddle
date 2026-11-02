/**
 * Unit tests for ticket-label (server/ticket-label.js), #788: how a ticket is
 * named in its team's Huddle.
 */
import { describe, it, expect } from 'vitest';

import {
  huddleTicketLabel,
  redmineIssueLabel,
  ticketName,
  ticketPath,
} from '../server/ticket-label';

const ID = '64f0c1a2b3c4d5e6f7a3fa2c';
const REDMINE_HOST = 'redmine.example.com';
const IDS = {
  ticketPrefix: 'TH',
  sourcePrefixes: [
    { host: REDMINE_HOST, prefix: 'RMX', type: 'redmine' },
    { host: 'jira.example.com', prefix: 'JRA', type: 'redmine' },
  ],
};

const label = (ticket: Record<string, unknown>) =>
  huddleTicketLabel({ _id: ID, title: 'Fix login', number: 123, ...ticket }, IDS, REDMINE_HOST);

describe('huddleTicketLabel', () => {
  it('names a TimeHuddle ticket by its own ID and title', () => {
    expect(label({})).toEqual({ ref: 'TH-123', title: 'Fix login', path: `/app/tickets/${ID}` });
  });

  it('names a ticket linked to a GitHub issue by the repo ID, with its title', () => {
    expect(label({ github: 'https://github.com/mieweb/pulse/issues/223' })).toMatchObject({
      ref: 'pulse-223',
      title: 'Fix login',
    });
  });

  it('names a ticket carrying a Redmine issue by the issue ID, with its title', () => {
    expect(label({ linkedIssue: { id: '656', host: REDMINE_HOST } })).toEqual({
      ref: 'RMX-656',
      title: 'Fix login',
      path: `/app/tickets/${ID}`,
    });
  });

  it('reads a carried issue with no host as on the deployment’s Redmine', () => {
    expect(label({ linkedIssue: { id: '656' } }).ref).toBe('RMX-656');
  });

  it('names a ticket linked to another named server by its ID, with its title', () => {
    expect(label({ github: 'https://jira.example.com/issues/772' })).toMatchObject({
      ref: 'JRA-772',
      title: 'Fix login',
    });
  });

  it('keeps its own ID when a carried issue’s server has no prefix', () => {
    expect(label({ linkedIssue: { id: '656', host: 'other.example.com' } })).toMatchObject({
      ref: 'TH-123',
      title: 'Fix login',
    });
  });

  it('keeps its own ID and title when its link is saved as just a link', () => {
    expect(
      label({ github: 'https://github.com/mieweb/pulse/issues/223', linkIsIssue: false }),
    ).toMatchObject({ ref: 'TH-123', title: 'Fix login' });
  });

  it('keeps its own ID and title for a link that names no issue', () => {
    expect(label({ github: 'https://example.com/docs' })).toMatchObject({
      ref: 'TH-123',
      title: 'Fix login',
    });
  });

  it('falls back to the tail of its id before it is numbered', () => {
    expect(label({ number: undefined }).ref).toBe('#3fa2c');
  });
});

describe('redmineIssueLabel', () => {
  it('names a bare issue by its outside ID', () => {
    expect(redmineIssueLabel('200', IDS.sourcePrefixes, REDMINE_HOST)).toEqual({
      ref: 'RMX-200',
      title: null,
      path: '/app/tickets/redmine/200',
    });
  });

  it('falls back to the number when the server has no prefix', () => {
    expect(redmineIssueLabel('200', [], REDMINE_HOST).ref).toBe('#200');
    expect(redmineIssueLabel('200', IDS.sourcePrefixes, null).ref).toBe('#200');
  });
});

describe('ticketName', () => {
  it('keeps a title with line breaks on one line', () => {
    expect(ticketName({ ref: 'TH-1', title: 'Fix\r\nlogin\n\nredirect' })).toBe(
      'TH-1: Fix login redirect',
    );
  });

  it('falls back to the ID alone when there is no title', () => {
    expect(ticketName({ ref: 'TH-1', title: '  ' })).toBe('TH-1');
    expect(ticketName({ ref: 'TH-1', title: null })).toBe('TH-1');
  });
});

describe('ticketPath', () => {
  it('points at the ticket page for its source', () => {
    expect(ticketPath('huddle', 'abc')).toBe('/app/tickets/abc');
    expect(ticketPath('redmine', '42')).toBe('/app/tickets/redmine/42');
  });
});
