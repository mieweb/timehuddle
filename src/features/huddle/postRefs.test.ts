import { describe, expect, it } from 'vitest';
import { postRefsIn, refsNeeded } from './postRefs';
import type { TeamMember } from './types';

describe('postRefs', () => {
  it('asks only for the lookups the text needs', () => {
    expect(refsNeeded('Plain update')).toEqual({ members: false, tickets: false });
    expect(refsNeeded('With @Pam on [TH-1](/app/tickets/t1)')).toEqual({
      members: true,
      tickets: true,
    });
  });

  it("resolves mentions and the team's linked tickets", () => {
    const members = [{ id: 'u-pam', name: 'Pam Beesly' }] as TeamMember[];
    const text = 'With @Pam on [TH-1](/app/tickets/t1) and [x](/app/tickets/other)';
    expect(postRefsIn(text, { members, ticketIds: new Set(['t1']) })).toEqual({
      mentions: ['u-pam'],
      ticketIds: ['t1'],
    });
  });
});
