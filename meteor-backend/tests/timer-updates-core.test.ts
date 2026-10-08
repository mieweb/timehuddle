/**
 * Unit tests for timer-updates-core (server/timer-updates-core.js), #681.
 */
import { describe, it, expect } from 'vitest';

import {
  TimerUpdate,
  startAction,
  ticketName,
  ticketPath,
  timerUpdateText,
} from '../server/timer-updates-core';

describe('timerUpdateText', () => {
  it('names a Redmine issue by its number only, linked to its page in the app', () => {
    expect(
      timerUpdateText(TimerUpdate.STARTED, { source: 'redmine', ticketId: '200', title: 'PHI' }),
    ).toBe('*Started [#200](/app/tickets/redmine/200) ticket of Redmine*');
  });

  it('names a Huddle ticket by its short reference and title', () => {
    expect(
      timerUpdateText(TimerUpdate.STOPPED, {
        source: 'huddle',
        ticketId: '64f0c1a2b3c4d5e6f7a3fa2c',
        title: 'Fix login',
      }),
    ).toBe('*Stopped [#3fa2c: Fix login](/app/tickets/64f0c1a2b3c4d5e6f7a3fa2c)*');
  });

  it('has a wording for each action', () => {
    const ticket = { source: 'redmine', ticketId: '7' };
    expect(timerUpdateText(TimerUpdate.SWITCHED, ticket)).toContain('Switched to [#7]');
    expect(timerUpdateText(TimerUpdate.RESUMED, ticket)).toContain('Resumed [#7]');
    expect(timerUpdateText(TimerUpdate.RESUMED, ticket)).toContain('ticket of Redmine');
  });

  it('keeps markup in a title from taking effect', () => {
    expect(
      timerUpdateText(TimerUpdate.STARTED, { source: 'huddle', ticketId: 'abc', title: '*a* [b](c)' }),
    ).toBe('*Started [#abc: \\*a\\* \\[b\\]\\(c\\)](/app/tickets/abc)*');
  });

  it('falls back to the reference alone when a Huddle ticket has no title', () => {
    expect(ticketName('huddle', '64f0c1a2b3c4d5e6f7a3fa2c', '  ')).toBe('#3fa2c');
  });
});

describe('ticketPath', () => {
  it('points at the ticket page for its source', () => {
    expect(ticketPath('huddle', 'abc')).toBe('/app/tickets/abc');
    expect(ticketPath('redmine', '42')).toBe('/app/tickets/redmine/42');
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
