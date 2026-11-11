/**
 * Unit tests for pulse-link-hints-core (server/pulse-link-hints-core.js):
 * which Pulse destinations are a place, the `ref` that keys one, and what the
 * place and a recording made for it are called.
 */
import { createHash } from 'crypto';

import { buildUploadLink } from '@mieweb/pulsevault/core';
import { describe, it, expect } from 'vitest';

import { isPulsePlace, pulseLinkHints, resolvedPlace, teamPlace } from '../server/pulse-link-hints-core';

const USER = 'user1';
const TICKET = 'a'.repeat(24);
const TEAM = 'b'.repeat(24);
const SESSION = 'c'.repeat(24);

/** The ref of the place spelled `<userId>:<kind>[:<key>]`. */
const refOf = (spelled: string) =>
  createHash('sha256').update(spelled).digest('base64url').slice(0, 16);

describe('pulseLinkHints', () => {
  it('keys a ticket by its id, and names it and its recordings by its title', () => {
    const resolved = { kind: 'ticket', id: TICKET };
    expect(pulseLinkHints(USER, resolved, { title: ' Fix login ' })).toEqual({
      ref: refOf(`${USER}:ticket:${TICKET}`),
      label: 'Fix login',
      name: 'Fix login',
    });
    // A title that couldn't be looked up: the plain label, and no name.
    expect(pulseLinkHints(USER, resolved)).toEqual({
      ref: refOf(`${USER}:ticket:${TICKET}`),
      label: 'Ticket video',
    });
  });

  it('keys and names every place, with a name where one reads well as content', () => {
    const names = { team: 'Platform', title: 'ignored unless a ticket' };
    const places = [
      [{ kind: 'huddle', teamId: TEAM }, refOf(`${USER}:huddle:${TEAM}`), 'Platform · Huddle', 'Huddle update'],
      [
        { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-09', reservedAt: 123 },
        refOf(`${USER}:clock-plan:${TEAM}:2026-11-09`),
        'Platform · Clock-in plan',
        'Clock-in plan',
      ],
      [
        { kind: 'clock-wrapup', clockEventId: SESSION, postDate: '2026-11-09' },
        refOf(`${USER}:clock-wrapup:${SESSION}`),
        'Platform · Wrap-up',
        undefined,
      ],
      [{ kind: 'clock', id: SESSION }, refOf(`${USER}:clock:${SESSION}`), 'Session video', undefined],
      [
        { kind: 'timesheet-request', id: TICKET },
        refOf(`${USER}:timesheet-request:${TICKET}`),
        'Timesheet walkthrough',
        'Walkthrough',
      ],
      [{ kind: 'library' }, refOf(`${USER}:library`), 'Media library', undefined],
    ] as const;
    for (const [resolved, ref, label, name] of places) {
      const hints = pulseLinkHints(USER, resolved, names);
      expect(hints).toMatchObject({ ref, label });
      expect(hints?.name).toBe(name);
    }
  });

  it('makes the ref a short opaque key: 16 URL-safe characters, whatever the place', () => {
    const refs = [
      pulseLinkHints(USER, { kind: 'library' })?.ref,
      pulseLinkHints(USER, { kind: 'ticket', id: TICKET })?.ref,
      pulseLinkHints(USER, { kind: 'clock-plan', teamId: 'x'.repeat(300), postDate: '2026-11-09' })?.ref,
    ];
    for (const ref of refs) expect(ref).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(refs[1]).not.toContain(USER);
  });

  it('gives the same place the same ref every time, and every other place another', () => {
    const huddle = { kind: 'huddle', teamId: TEAM };
    const ref = pulseLinkHints(USER, huddle)?.ref;
    // The same place: whatever it is called by now, and however often it is asked for.
    expect(pulseLinkHints(USER, { ...huddle }, { team: 'Renamed' })?.ref).toBe(ref);
    const others = [
      pulseLinkHints('user2', huddle), // another person
      pulseLinkHints(USER, { kind: 'huddle', teamId: SESSION }), // another team
      pulseLinkHints(USER, { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-09' }), // another kind
      pulseLinkHints(USER, { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-10' }), // another day
      pulseLinkHints(USER, { kind: 'library' }),
    ].map((hints) => hints?.ref);
    expect(new Set([ref, ...others]).size).toBe(others.length + 1);
  });

  it('falls back to the plain label when the team has no name to show', () => {
    const labels = [
      [{ kind: 'huddle', teamId: TEAM }, 'Huddle update'],
      [{ kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-09' }, 'Clock-in plan'],
      [{ kind: 'clock-wrapup', clockEventId: SESSION, postDate: '2026-11-09' }, 'Wrap-up'],
    ] as const;
    for (const [resolved, label] of labels) {
      expect(pulseLinkHints(USER, resolved)?.label).toBe(label);
      expect(pulseLinkHints(USER, resolved, { team: '  ' })?.label).toBe(label);
    }
  });

  it('cuts a long team name, not what the place is, and a long title, each ending in an ellipsis', () => {
    const label = pulseLinkHints(USER, { kind: 'huddle', teamId: TEAM }, { team: 'x'.repeat(100) })?.label;
    expect(Array.from(label ?? '')).toHaveLength(40);
    expect(label?.endsWith('… · Huddle')).toBe(true);
    const hints = pulseLinkHints(USER, { kind: 'ticket', id: TICKET }, { title: 'x'.repeat(100) });
    expect(hints?.label).toBe(`${'x'.repeat(39)}…`);
    expect(hints?.name).toBe(`${'x'.repeat(39)}…`);
    // One that fits is left as it is, and a cut never ends in a space.
    expect(pulseLinkHints(USER, { kind: 'ticket', id: TICKET }, { title: 'x'.repeat(40) })?.name).toBe('x'.repeat(40));
    expect(pulseLinkHints(USER, { kind: 'ticket', id: TICKET }, { title: `${'x'.repeat(38)} 😀😀` })?.name).toBe(
      `${'x'.repeat(38)}…`,
    );
  });

  it('cuts at a whole character: never through an accent or an emoji sequence', () => {
    const ticket = { kind: 'ticket', id: TICKET };
    // "é" written as e + a combining accent is two code points: 36 + 2 fit beside the ellipsis, 36 + 3 don't.
    const accented = pulseLinkHints(USER, ticket, { title: `${'x'.repeat(36)}${'e\u0301'.repeat(3)}` });
    expect(accented?.label).toBe(`${'x'.repeat(36)}e\u0301…`);
    // A family is one character of seven code points.
    const family = '👨‍👩‍👧‍👦';
    const families = pulseLinkHints(USER, ticket, { title: `${'x'.repeat(30)}${family}${family}` });
    expect(families?.label).toBe(`${'x'.repeat(30)}${family}…`);
    // Nothing of a name survives when its first character alone is too long: the plain label, no name.
    expect(pulseLinkHints(USER, ticket, { title: `Z${'\u0301'.repeat(60)}` })).toEqual({
      ref: refOf(`${USER}:ticket:${TICKET}`),
      label: 'Ticket video',
    });
  });

  it('bounds what a name adds to the link, where a character outside ASCII takes 6 to 12', () => {
    /** The characters `text` takes in a link's parameters. */
    const encoded = (text = '') => new URLSearchParams({ t: text }).toString().length - 2;
    const ticket = { kind: 'ticket', id: TICKET };
    // 40 Latin letters are 40 on the link; 40 CJK characters would be 360, and 40 emoji 480.
    expect(pulseLinkHints(USER, ticket, { title: '修'.repeat(100) })?.label).toBe(`${'修'.repeat(12)}…`);
    expect(pulseLinkHints(USER, ticket, { title: '😀'.repeat(100) })?.name).toBe(`${'😀'.repeat(9)}…`);
    // A team's name leaves room for what the place is.
    const huddle = pulseLinkHints(USER, { kind: 'huddle', teamId: TEAM }, { team: '修'.repeat(100) })?.label;
    expect(huddle).toBe(`${'修'.repeat(10)}… · Huddle`);
    for (const called of ['x'.repeat(100), '%&+/'.repeat(30), 'é'.repeat(100), 'Ж'.repeat(100), '修'.repeat(100)]) {
      for (const resolved of [ticket, { kind: 'huddle', teamId: TEAM }, { kind: 'clock-wrapup', clockEventId: SESSION }]) {
        const hints = pulseLinkHints(USER, resolved, { title: called, team: called });
        for (const hint of [hints?.label, hints?.name]) {
          expect(encoded(hint)).toBeLessThanOrEqual(120);
          expect(Array.from(hint ?? '').length).toBeLessThanOrEqual(40);
        }
      }
    }
  });

  it('makes a name one line of plain text: no line breaks, control or text-reordering characters', () => {
    const ticket = { kind: 'ticket', id: TICKET };
    const label = (title: unknown) => pulseLinkHints(USER, ticket, { title })?.label;
    expect(label('Fix\r\nthe\tlogin\u0000page')).toBe('Fix the login page');
    expect(label('one\u2028two\u2029three')).toBe('one two three');
    expect(label('\u202Egnp.exe\u202C \u2066safe\u2069')).toBe('gnp.exe safe');
    // Nothing to show: the plain label, and no name.
    expect(pulseLinkHints(USER, ticket, { title: ' \u200B\u200E\u202E ' })).toEqual({
      ref: refOf(`${USER}:ticket:${TICKET}`),
      label: 'Ticket video',
    });
    expect(pulseLinkHints(USER, { kind: 'huddle', teamId: TEAM }, { team: 'Plat\u202Eform\n' })?.label).toBe(
      'Platform · Huddle',
    );
  });

  it('falls back to the plain label when what is left of a name once cut shows as nothing', () => {
    // 60 zero-width characters, then the words: the first 39 are all that fit, and they are nothing.
    const hidden = `${'\u200B'.repeat(60)}Fix login`;
    expect(pulseLinkHints(USER, { kind: 'ticket', id: TICKET }, { title: hidden })).toEqual({
      ref: refOf(`${USER}:ticket:${TICKET}`),
      label: 'Ticket video',
    });
    expect(pulseLinkHints(USER, { kind: 'huddle', teamId: TEAM }, { team: hidden })?.label).toBe('Huddle update');
    expect(pulseLinkHints(USER, { kind: 'clock-wrapup', clockEventId: SESSION }, { team: hidden })?.label).toBe(
      'Wrap-up',
    );
    // Joiners and soft hyphens are format characters too.
    expect(
      pulseLinkHints(USER, { kind: 'ticket', id: TICKET }, { title: `${'\u200D\u00AD'.repeat(40)} Fix login` })?.label,
    ).toBe('Ticket video');
    // A few of them before words that fit are left alone, as the package leaves them.
    expect(pulseLinkHints(USER, { kind: 'ticket', id: TICKET }, { title: '\u200BFix login' })?.label).toBe(
      '\u200BFix login',
    );
  });

  it("names a place so that @mieweb/pulsevault's link carries the names unchanged", () => {
    const family = '👨‍👩‍👧‍👦';
    const names = [
      'Fix the login page',
      'x'.repeat(100),
      'Fix\r\nthe\tlogin\u0000 page',
      '\u202Egnp.exe\u202C \u2066safe\u2069',
      'one\u2028two\u2029three',
      '修'.repeat(100),
      family.repeat(30),
      '🇮🇳'.repeat(50),
      'e\u0301'.repeat(90),
      `half a pair \uD83D${'x'.repeat(60)}`,
      `${'\u200B'.repeat(60)}Fix login`,
      `${'\u200D\u00AD'.repeat(40)} Fix login`,
      '\u200BFix login',
      '  spaced   out  ',
    ];
    for (const called of names) {
      for (const resolved of [
        { kind: 'ticket', id: TICKET },
        { kind: 'huddle', teamId: TEAM },
        { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-09' },
      ]) {
        const hints = pulseLinkHints(USER, resolved, { title: called, team: called });
        const link = buildUploadLink({
          server: 'https://timecore.example.org/pulsevault',
          artifactId: '11111111-2222-3333-4444-555555555555',
          label: hints?.label,
          name: hints?.name,
        });
        const params = new URL(link).searchParams;
        expect(params.get('label')).toBe(hints?.label);
        expect(params.get('name') ?? undefined).toBe(hints?.name);
      }
    }
  });

  it('gives none for a file a form attaches later, or an unknown kind', () => {
    for (const kind of ['post', 'walkthrough', 'constructor']) {
      expect(pulseLinkHints(USER, { kind })).toBeNull();
      expect(isPulsePlace(kind)).toBe(false);
    }
    expect(isPulsePlace('ticket')).toBe(true);
  });
});

describe('what a destination check hands on', () => {
  it("signs a team by the team's own id, however that id is stored", () => {
    // A team made by Meteor has a string id; a legacy one an ObjectId, which prints as lowercase hex.
    expect(teamPlace({ _id: 'aBcDeFgHiJkLmNoPq', name: 'Platform' })).toEqual({
      teamId: 'aBcDeFgHiJkLmNoPq',
      names: { team: 'Platform' },
    });
    const legacy = { _id: { toString: () => TEAM }, name: 'Platform' };
    expect(teamPlace(legacy).teamId).toBe(TEAM);
  });

  it('makes one team one place: the same ref whichever case the caller sent its id in', () => {
    // The check finds a legacy team by its hex id in either case, and signs the team's own.
    const team = { _id: { toString: () => TEAM }, name: 'Platform' };
    const refFor = () => {
      const { resolved, names } = resolvedPlace('huddle', teamPlace(team));
      return pulseLinkHints(USER, resolved, names)?.ref;
    };
    expect(refFor()).toBe(refOf(`${USER}:huddle:${TEAM}`));
    expect(refFor()).not.toBe(refOf(`${USER}:huddle:${TEAM.toUpperCase()}`));
  });

  it('keeps the names out of what is signed', () => {
    const checked = { ...teamPlace({ _id: TEAM, name: 'Platform' }), postDate: '2026-11-09', reservedAt: 123 };
    expect(resolvedPlace('clock-plan', checked)).toEqual({
      resolved: { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-09', reservedAt: 123 },
      names: { team: 'Platform' },
    });
    expect(resolvedPlace('ticket', { id: TICKET, names: { title: 'Fix login' } })).toEqual({
      resolved: { kind: 'ticket', id: TICKET },
      names: { title: 'Fix login' },
    });
    // A kind that reads no name has none.
    expect(resolvedPlace('library', {})).toEqual({ resolved: { kind: 'library' }, names: {} });
  });
});
