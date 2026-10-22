import { describe, expect, it } from 'vitest';

import type { UnifiedTicket } from './sources/types';
import { leadingRefOf, outsideIdOf, outsideRefOf, refNumber } from './ticketIds';

const prefixes = [{ host: 'redmine.example.com', prefix: 'PM' }];

describe('outsideIdOf', () => {
  it('names a GitHub issue or pull request by its repo and number, with no setup', () => {
    expect(outsideIdOf('https://github.com/mieweb/timehuddle/issues/223', [])).toBe(
      'timehuddle-223',
    );
    expect(outsideIdOf('https://github.com/mieweb/pulse/pull/554', [])).toBe('pulse-554');
    expect(outsideIdOf('https://github.com/mieweb/pulse/pull/554/files#diff', [])).toBe(
      'pulse-554',
    );
  });

  it('does not name a GitHub address that is not an issue or pull request', () => {
    expect(outsideIdOf('https://github.com/mieweb/timehuddle', [])).toBeNull();
  });

  it("names an address on a server the org has named by that server's prefix", () => {
    expect(outsideIdOf('https://redmine.example.com/issues/233', prefixes)).toBe('PM-233');
    expect(outsideIdOf('https://Redmine.Example.com/issues/233/', prefixes)).toBe('PM-233');
    expect(outsideIdOf('https://redmine.example.com/issues/233?tab=history', prefixes)).toBe(
      'PM-233',
    );
  });

  it('does not name an address on an unnamed server, or one with no number at the end', () => {
    expect(outsideIdOf('https://other.example.com/issues/233', prefixes)).toBeNull();
    expect(outsideIdOf('https://redmine.example.com/projects/web', prefixes)).toBeNull();
  });

  it('does not name what is not an address', () => {
    expect(outsideIdOf('', prefixes)).toBeNull();
    expect(outsideIdOf(null, prefixes)).toBeNull();
    expect(outsideIdOf('see the doc', prefixes)).toBeNull();
  });
});

describe('refNumber', () => {
  it('takes the number at the end of a ref', () => {
    expect(refNumber('PM-233')).toBe('233');
    expect(refNumber('#233')).toBe('233');
    expect(refNumber('#3fa2c')).toBeNull();
  });
});

describe('outsideRefOf and leadingRefOf', () => {
  const ticket = (fields: Partial<UnifiedTicket>) =>
    ({ ref: 'THX-18', linked: null, externalRef: null, ...fields }) as UnifiedTicket;

  it('leads with the TimeHuddle ID of a pure TimeHuddle ticket', () => {
    expect(outsideRefOf(ticket({}))).toBeNull();
    expect(leadingRefOf(ticket({}))).toBe('THX-18');
  });

  it('leads with the issue a ticket is linked to', () => {
    const linked = ticket({
      ref: 'THX-20',
      linked: { sourceId: 'redmine', id: '214', ref: 'RM0-214', status: null, assignee: null },
    });
    expect(outsideRefOf(linked)).toBe('RM0-214');
    expect(leadingRefOf(linked)).toBe('RM0-214');
  });

  it('leads with the outside ID of a link the ticket carries, when it has one', () => {
    const url = 'https://github.com/mieweb/timehuddle/issues/717';
    const named = ticket({
      ref: 'THX-19',
      externalRef: { url, label: 'GitHub', id: 'timehuddle-717' },
    });
    expect(leadingRefOf(named)).toBe('timehuddle-717');
    const unnamed = ticket({ ref: 'THX-19', externalRef: { url, label: 'Issue link', id: null } });
    expect(leadingRefOf(unnamed)).toBe('THX-19');
  });
});
