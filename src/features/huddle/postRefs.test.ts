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

  it('names a picked mention exactly by its profile link, among shared first names', () => {
    const members = [
      { id: 'u-pam', name: 'Pam Beesly' },
      { id: 'u-pam2', name: 'Pam Halpert' },
    ] as TeamMember[];
    const text = 'Ask [@Pam Halpert](/app/profile/u-pam2) and [@Gone](/app/profile/u-gone)';
    expect(refsNeeded(text).members).toBe(true);
    expect(postRefsIn(text, { members, ticketIds: new Set() }).mentions).toEqual(['u-pam2']);
  });

  it("doesn't read a picked mention's label as a typed one", () => {
    const members = [
      { id: 'u-ann', name: 'Ann Smith' },
      { id: 'u-annmarie', name: 'Ann-Marie Jones' },
    ] as TeamMember[];
    const text = 'Ask [@Ann-Marie Jones](/app/profile/u-annmarie)';
    expect(postRefsIn(text, { members, ticketIds: new Set() }).mentions).toEqual(['u-annmarie']);
  });

  it('skips a picked label that holds escaped brackets', () => {
    const members = [
      { id: 'u-ann', name: 'Ann Smith' },
      { id: 'u-annmarie', name: 'Ann-Marie Jones' },
    ] as TeamMember[];
    const text = 'Ask [@Ann-Marie Jones \\[PTO\\]](/app/profile/u-annmarie)';
    expect(postRefsIn(text, { members, ticketIds: new Set() }).mentions).toEqual(['u-annmarie']);
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
