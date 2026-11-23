/**
 * Unit tests for timer-updates-core (server/timer-updates-core.js), #681, #788.
 */
import { describe, it, expect } from 'vitest';

import { huddleTicketLabel, redmineIssueLabel } from '../server/ticket-label';
import {
  PlanUpdate,
  TimerUpdate,
  planUpdateText,
  startAction,
  timerUpdateText,
  workedFor,
} from '../server/timer-updates-core';

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
        label({ title: null, linkedIssue: { id: '656', host: REDMINE_HOST } }),
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

describe('a switch that checks a ticket off (#886)', () => {
  it('names the ticket checked off and its time', () => {
    const other = huddleTicketLabel({ _id: 'b'.repeat(24), title: 'Docs', number: 9 }, IDS, null);
    expect(
      timerUpdateText(TimerUpdate.SWITCHED, label({}), {
        checkedOff: { label: other, seconds: 70 * 60 + 59 },
      }),
    ).toBe(
      `*Switched to [TH-123: Fix login](/app/tickets/${ID}) · [TH-9: Docs](/app/tickets/${'b'.repeat(24)}) checked off at 1h 10m*`,
    );
  });
});

describe('workedFor', () => {
  it('reads in hours and minutes, minutes alone under an hour', () => {
    expect(workedFor(0)).toBe('0m');
    expect(workedFor(25 * 60 + 30)).toBe('25m');
    expect(workedFor(2 * 3600)).toBe('2h 0m');
  });
});

describe('planUpdateText (#886)', () => {
  it('announces a ticket added to today’s plan', () => {
    expect(planUpdateText(PlanUpdate.ADDED, { label: label({}) })).toBe(
      `*Added [TH-123: Fix login](/app/tickets/${ID}) to today's plan*`,
    );
  });

  it('says how long a ticket had when it was checked off by hand', () => {
    expect(planUpdateText(PlanUpdate.CHECKED, { label: label({}) }, 600)).toBe(
      `*Checked off [TH-123: Fix login](/app/tickets/${ID}) at 10m*`,
    );
  });

  it('quotes a text item as plain words: a picked mention links no one', () => {
    expect(
      planUpdateText(PlanUpdate.UNCHECKED, { text: 'Call [@Ann](/app/profile/u1) *now*' }),
    ).toBe('*Unchecked “Call @Ann \\*now\\*”*');
    expect(planUpdateText(PlanUpdate.CHECKED, { text: 'Lunch' })).toBe('*Checked off “Lunch”*');
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
