/**
 * Unit tests for timer-updates-core (server/timer-updates-core.js), #681, #788.
 */
import { describe, it, expect } from 'vitest';

import { huddleTicketLabel, redmineIssueLabel } from '../server/ticket-label';
import { TimerUpdate, startAction, timerUpdateText } from '../server/timer-updates-core';

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

describe('timerUpdateText', () => {
  it('links the ID and title to the ticket page', () => {
    expect(timerUpdateText(TimerUpdate.STOPPED, label({}))).toBe(
      `*Stopped [TH-123: Fix login](/app/tickets/${ID})*`,
    );
  });

  it('links an ID alone when there is no title to show', () => {
    expect(
      timerUpdateText(
        TimerUpdate.STARTED,
        label({ linkedIssue: { id: '656', host: REDMINE_HOST } }),
      ),
    ).toBe(`*Started [RMX-656](/app/tickets/${ID})*`);
  });

  it('has a wording for each action', () => {
    const ticket = redmineIssueLabel('7', IDS.sourcePrefixes, REDMINE_HOST);
    expect(timerUpdateText(TimerUpdate.STARTED, ticket)).toContain('Started [RMX-7]');
    expect(timerUpdateText(TimerUpdate.SWITCHED, ticket)).toContain('Switched to [RMX-7]');
    expect(timerUpdateText(TimerUpdate.STOPPED, ticket)).toContain('Stopped [RMX-7]');
    expect(timerUpdateText(TimerUpdate.RESUMED, ticket)).toContain('Resumed [RMX-7]');
  });

  it('keeps markup in a title from taking effect', () => {
    expect(timerUpdateText(TimerUpdate.STARTED, label({ title: '*a* [b](c)' }))).toBe(
      `*Started [TH-123: \\*a\\* \\[b\\]\\(c\\)](/app/tickets/${ID})*`,
    );
  });
});

describe('startAction', () => {
  it('is a start when nothing was running', () => {
    expect(startAction({ previousWorkItemId: null, workItemId: 'b' })).toBe(TimerUpdate.STARTED);
  });

  it('is a switch when it took over from another ticket', () => {
    expect(startAction({ previousWorkItemId: 'a', workItemId: 'b' })).toBe(TimerUpdate.SWITCHED);
  });

  it('is a start when the other ticket’s update is being discarded', () => {
    expect(startAction({ previousWorkItemId: 'a', workItemId: 'b', discardPrevious: true })).toBe(
      TimerUpdate.STARTED,
    );
  });

  it('posts nothing for the work item that was already running', () => {
    expect(startAction({ previousWorkItemId: 'a', workItemId: 'a' })).toBeNull();
  });
});
