import { describe, expect, it } from 'vitest';

import {
  RECORD_FIELDS,
  SOURCES,
  defineSource,
  github,
  hook,
  isHook,
  matchIssueUrl,
  outsideIdOf,
  redmine,
  showId,
} from './index.js';

const minimal = { kind: 'demo', label: 'Demo', id: { show: '{prefix}-{key}' } };

describe('the three definitions', () => {
  it.each(Object.entries(SOURCES))('%s describes only fields of the ticket record', (_, source) => {
    for (const field of Object.keys(source.fields)) expect(RECORD_FIELDS).toContain(field);
  });

  it('are frozen, so nothing can change a source at run time', () => {
    expect(Object.isFrozen(redmine)).toBe(true);
    expect(Object.isFrozen(redmine.fields.status)).toBe(true);
  });

  it("read Redmine's attachments, which come with the issue", () => {
    expect(RECORD_FIELDS).toContain('attachments');
    expect(redmine.fields.attachments).toMatchObject({ path: 'attachments', name: 'filename' });
  });

  it('reads a reviewed TimeHuddle ticket as closed, as the Open/Closed tabs do', () => {
    expect(SOURCES.timehuddle.fields.status?.closedWhen).toEqual({ in: ['closed', 'reviewed'] });
  });

  it('name what plain data cannot say as hooks', () => {
    expect(isHook(redmine.fields.conversation?.from)).toBe(true);
    expect(redmine.can.sendTime).toEqual({ hook: 'redmineSendTime' });
    expect(redmine.can.write).toEqual({ hook: 'redmineWrite' });
  });
});

describe('defineSource', () => {
  it('fills in what a definition leaves out', () => {
    const source = defineSource(minimal);
    expect(source.connect).toEqual({ auth: 'none' });
    expect(source.fields).toEqual({});
    expect(source.can).toEqual({});
  });

  it.each([
    ['a kind with capitals', { ...minimal, kind: 'Redmine' }, /kind must be lowercase/],
    ['no label', { ...minimal, label: '' }, /label is required/],
    ['a function', { ...minimal, can: { search: () => true } }, /is a function; use hook/],
    [
      'a field the record does not have',
      { ...minimal, fields: { colour: { path: 'c' } } },
      /fields.colour is not a field/,
    ],
    [
      'an editable field with nowhere to read it from',
      { ...minimal, fields: { title: { edit: true } } },
      /editable but has nowhere to read it from/,
    ],
    ['an unknown sign-in', { ...minimal, connect: { auth: 'cookie' } }, /connect.auth must be/],
    [
      'a header sign-in with no header',
      { ...minimal, connect: { auth: 'header' } },
      /connect.header/,
    ],
    ['an unknown paging style', { ...minimal, api: { paging: 'cursor' } }, /api.paging must be/],
    [
      'an ID template without {key}',
      { ...minimal, id: { show: '{prefix}' } },
      /must be a template/,
    ],
    [
      'a body format it cannot read',
      { ...minimal, fields: { body: { path: 'b', format: 'html' } } },
      /format must be/,
    ],
    ['a global ID match', { ...minimal, id: { ...minimal.id, match: /x/g } }, /g or y flag/],
    [
      'a priority rank that is not a number',
      { ...minimal, fields: { priority: { path: 'p', ranks: { low: 'one' } } } },
      /ranks must map names to numbers/,
    ],
    ['a sticky ID match', { ...minimal, id: { ...minimal.id, match: /x/y } }, /g or y flag/],
  ])('refuses %s', (_, definition, message) => {
    // Invalid on purpose: what the types would refuse, a JS caller can still pass.
    expect(() => defineSource(definition as never)).toThrow(message);
  });

  it('refuses styling on an ID: every source shows its IDs the same way', () => {
    expect(() =>
      defineSource({ ...minimal, id: { show: '{prefix}-{key}', color: 'red' } }),
    ).toThrow(/id.color is not allowed; an ID is plain text/);
  });

  it('freezes what sits under a part that was frozen already', () => {
    const source = defineSource({
      ...minimal,
      fields: Object.freeze({ title: { path: 'title' } }),
    });
    expect(Object.isFrozen(source.fields.title)).toBe(true);
  });

  it('refuses a hook with no name', () => {
    expect(() => hook('')).toThrow();
  });
});

describe('matchIssueUrl and showId', () => {
  it('reads a GitHub issue or pull request, and shows it as <repo>-<number>', () => {
    const ref = matchIssueUrl(github, 'https://github.com/mieweb/timehuddle/issues/223');
    expect(ref).toEqual({ container: 'mieweb/timehuddle', key: '223' });
    expect(showId(github, ref!)).toBe('timehuddle-223');
    expect(matchIssueUrl(github, 'https://github.com/mieweb/pulse/pull/554/files')).toEqual({
      container: 'mieweb/pulse',
      key: '554',
    });
  });

  it('reads a Redmine issue at the root of its server or under a path', () => {
    expect(matchIssueUrl(redmine, 'https://redmine0.os.mieweb.org/issues/214')).toEqual({
      key: '214',
    });
    expect(matchIssueUrl(redmine, 'https://example.com/redmine/issues/214/')).toEqual({
      key: '214',
    });
    expect(showId(redmine, { key: '214' }, 'RM0')).toBe('RM0-214');
  });

  it('reads nothing that is not one of its issues', () => {
    expect(matchIssueUrl(github, 'https://github.com/mieweb/timehuddle')).toBeNull();
    expect(matchIssueUrl(github, 'https://gitlab.com/mieweb/timehuddle/issues/1')).toBeNull();
    expect(matchIssueUrl(redmine, 'https://redmine0.os.mieweb.org/projects/web')).toBeNull();
    expect(matchIssueUrl(redmine, 'not an address')).toBeNull();
  });
});

// Copied unchanged from src/features/tickets/ticketIds.test.ts: moving
// `outsideIdOf` into the package must not change a single answer.
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
