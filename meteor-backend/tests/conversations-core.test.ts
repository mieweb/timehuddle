/**
 * Unit tests for conversations-core (server/conversations-core.js), #866.
 */
import { describe, it, expect } from 'vitest';

import {
  LABEL_MAX,
  audienceFilter,
  audienceOf,
  canSee,
  checkStartDateKey,
  cleanLabel,
  directKey,
  displayLabel,
  isOpen,
  isOutsideAudience,
  isTeamMember,
  legacyDateKeyFor,
  teamForAudience,
  utcDateKey,
} from '../server/conversations-core';

const team = { _id: 'team1', members: ['cindy', 'bob'], admins: ['admin'] };

describe('isTeamMember', () => {
  it('counts members and admins', () => {
    expect(isTeamMember(team, 'cindy')).toBe(true);
    expect(isTeamMember(team, 'admin')).toBe(true);
  });
  it('rejects outsiders and missing input', () => {
    expect(isTeamMember(team, 'eve')).toBe(false);
    expect(isTeamMember(null, 'cindy')).toBe(false);
    expect(isTeamMember(team, '')).toBe(false);
  });
});

describe('directKey', () => {
  it('is the same whichever person starts it', () => {
    expect(directKey('cindy', 'bob')).toBe(directKey('bob', 'cindy'));
    expect(directKey('cindy', 'bob')).toBe('bob:cindy');
  });
  it('refuses a conversation with yourself or a missing person', () => {
    expect(() => directKey('cindy', 'cindy')).toThrow();
    expect(() => directKey('cindy', '')).toThrow();
  });
});

describe('isOpen', () => {
  it('a workday is open until it has closedAt', () => {
    expect(isOpen({ kind: 'workday', closedAt: null })).toBe(true);
    expect(isOpen({ kind: 'workday', closedAt: new Date() })).toBe(false);
  });
  it('group and direct conversations never close', () => {
    expect(isOpen({ kind: 'group' })).toBe(true);
    expect(isOpen({ kind: 'direct', closedAt: new Date() })).toBe(true);
  });
  it('nothing is not open', () => {
    expect(isOpen(null)).toBe(false);
  });
});

describe('canSee', () => {
  const workday = { teamId: 'team1', kind: 'workday' };
  const direct = { teamId: 'team1', kind: 'direct', memberIds: ['cindy', 'bob'] };
  const group = { teamId: 'team1', kind: 'group', memberIds: ['cindy'] };

  it('a workday is open to everyone on the team', () => {
    expect(canSee(workday, 'bob', team)).toBe(true);
    expect(canSee(workday, 'admin', team)).toBe(true);
  });
  it('group and direct conversations are members only, admins included', () => {
    expect(canSee(direct, 'bob', team)).toBe(true);
    expect(canSee(group, 'bob', team)).toBe(false);
    expect(canSee(group, 'admin', team)).toBe(false);
  });
  it('someone off the team sees nothing, even a listed member', () => {
    const leftTeam = { ...team, members: ['cindy'] };
    expect(canSee(direct, 'bob', leftTeam)).toBe(false);
  });
  it('a conversation of another team is never visible', () => {
    expect(canSee({ ...workday, teamId: 'team2' }, 'bob', team)).toBe(false);
  });
  it('matches an ObjectId-like team id by its string form', () => {
    const oidTeam = { ...team, _id: { toString: () => 'team1' } };
    expect(canSee(workday, 'bob', oidTeam)).toBe(true);
  });
});

describe('cleanLabel', () => {
  it('trims a usable name', () => {
    expect(cleanLabel('  Release 4.2  ')).toEqual({ label: 'Release 4.2' });
  });
  it('treats an empty name as clearing it', () => {
    expect(cleanLabel('   ')).toEqual({ label: null });
    expect(cleanLabel(null)).toEqual({ label: null });
    expect(cleanLabel(undefined)).toEqual({ label: null });
  });
  it('refuses a name that is too long or not text', () => {
    expect(cleanLabel('x'.repeat(LABEL_MAX))).toEqual({ label: 'x'.repeat(LABEL_MAX) });
    expect(cleanLabel('x'.repeat(LABEL_MAX + 1)).error).toBeTruthy();
    expect(cleanLabel(42).error).toBeTruthy();
  });
});

describe('displayLabel', () => {
  const names: Record<string, string> = { cindy: 'Cindy', bob: 'Bob' };
  const nameOf = (id: string) => names[id] ?? null;
  const direct = { kind: 'direct', memberIds: ['cindy', 'bob'] };

  it('a direct conversation shows the other person', () => {
    expect(displayLabel(direct, 'cindy', { nameOf })).toBe('Bob');
    expect(displayLabel(direct, 'bob', { nameOf })).toBe('Cindy');
  });
  it('a personal name wins over everything', () => {
    expect(displayLabel(direct, 'cindy', { nameOf, personalLabel: 'B.' })).toBe('B.');
    expect(displayLabel({ kind: 'group', label: 'Release' }, 'cindy', { personalLabel: 'Mine' })).toBe(
      'Mine',
    );
  });
  it('a group shows its shared name', () => {
    expect(displayLabel({ kind: 'group', label: 'Release' }, 'cindy')).toBe('Release');
  });
  it('a workday has no stored name (the client formats its date)', () => {
    expect(displayLabel({ kind: 'workday', dateKey: '2026-11-11' }, 'cindy')).toBeNull();
  });
});

describe('legacyDateKeyFor', () => {
  it("uses the post's own date when it has one", () => {
    expect(legacyDateKeyFor({ postDate: '2026-11-11', createdAt: new Date('2026-11-12T07:00:00Z') })).toBe(
      '2026-11-11',
    );
  });
  it('falls back to the UTC date it went out', () => {
    expect(legacyDateKeyFor({ createdAt: new Date('2026-11-12T07:00:00Z') })).toBe('2026-11-12');
    expect(
      legacyDateKeyFor({
        createdAt: new Date('2026-11-10T07:00:00Z'),
        deliveredAt: new Date('2026-11-12T01:00:00Z'),
      }),
    ).toBe('2026-11-12');
  });
  it('ignores a malformed postDate', () => {
    expect(legacyDateKeyFor({ postDate: 'Nov 11', createdAt: new Date('2026-11-12T07:00:00Z') })).toBe(
      '2026-11-12',
    );
  });
});

describe('who may see a post (R21)', () => {
  const direct = { kind: 'direct', memberIds: ['cindy', 'bob'] };

  it('a team or direct conversation post carries its members; a workday post carries none', () => {
    expect(audienceOf(direct)).toEqual(['cindy', 'bob']);
    expect(audienceOf({ kind: 'group', memberIds: ['cindy'] })).toEqual(['cindy']);
    expect(audienceOf({ kind: 'workday' })).toBeNull();
    expect(audienceOf(null)).toBeNull();
  });
  it('a copy, so changing it never touches the conversation', () => {
    const copy = audienceOf(direct)!;
    copy.push('eve');
    expect(direct.memberIds).toEqual(['cindy', 'bob']);
  });
  it('only a post with an audience can be outside it', () => {
    expect(isOutsideAudience({ audienceIds: ['cindy', 'bob'] }, 'eve')).toBe(true);
    expect(isOutsideAudience({ audienceIds: ['cindy', 'bob'] }, 'bob')).toBe(false);
    expect(isOutsideAudience({}, 'eve')).toBe(false);
  });
  it('the query form matches the same posts', () => {
    expect(audienceFilter('bob')).toEqual({ $or: [{ audienceIds: { $exists: false } }, { audienceIds: 'bob' }] });
  });
  it('narrows a team to the audience for notifications', () => {
    const narrowed = teamForAudience({ ...team, members: ['cindy', 'bob', 'eve'] }, ['cindy', 'admin']);
    expect(narrowed.members).toEqual(['cindy']);
    expect(narrowed.admins).toEqual(['admin']);
    expect(teamForAudience(team, undefined)).toBe(team);
  });
});

describe('checkStartDateKey (R9)', () => {
  const now = new Date('2026-11-12T15:00:00Z');

  it("accepts the starter's date within a day of the server's", () => {
    expect(checkStartDateKey('2026-11-12', null, now)).toBeNull();
    expect(checkStartDateKey('2026-11-11', null, now)).toBeNull(); // far west of UTC
    expect(checkStartDateKey('2026-11-13', '2026-11-12', now)).toBeNull(); // far east of UTC
  });
  it('refuses a malformed or impossible date', () => {
    expect(checkStartDateKey('Nov 12', null, now)).toBeTruthy();
    expect(checkStartDateKey('2026-02-30', null, now)).toBeTruthy();
    expect(checkStartDateKey(undefined, null, now)).toBeTruthy();
  });
  it('refuses a device date more than a day off', () => {
    expect(checkStartDateKey('2026-11-10', null, now)).toBeTruthy();
    expect(checkStartDateKey('2026-11-14', null, now)).toBeTruthy();
  });
  it('refuses a date earlier than the workday already open', () => {
    expect(checkStartDateKey('2026-11-11', '2026-11-12', now)).toBeTruthy();
  });
});

describe('utcDateKey', () => {
  it('is the UTC calendar date', () => {
    expect(utcDateKey(new Date('2026-11-12T23:30:00Z'))).toBe('2026-11-12');
  });
});
