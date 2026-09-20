import { describe, expect, it } from 'vitest';

import { loadReleaseNotes, releaseNotes, unseenReleaseNotes } from './notes';
import type { ReleaseNote } from './parse';

const note = (version: string, date: string): ReleaseNote => ({
  version,
  date,
  title: `Release ${version}`,
  body: 'Body.',
});

describe('the real release-notes/ folder', () => {
  it('parses every note', () => {
    // The guardrail the folder's README points at: a bad version, a bad date or
    // a screenshot path that matches no file fails here rather than shipping.
    expect(loadReleaseNotes().errors).toEqual([]);
  });

  it('has at least one note, newest first', () => {
    expect(releaseNotes.length).toBeGreaterThan(0);
    const versions = releaseNotes.map((n) => n.version);
    expect(versions).toEqual([...versions].sort((a, b) => b.localeCompare(a, undefined)));
  });
});

describe('loadReleaseNotes', () => {
  const raw = (version: string, date: string) =>
    `---\nversion: ${version}\ndate: ${date}\ntitle: Release ${version}\n---\n\nBody.\n`;

  it('sorts newest version first, not lexically', () => {
    const { notes } = loadReleaseNotes({
      '../../../release-notes/1.9.0.md': raw('1.9.0', '2026-01-01'),
      '../../../release-notes/1.10.0.md': raw('1.10.0', '2026-02-01'),
      '../../../release-notes/1.2.0.md': raw('1.2.0', '2025-12-01'),
    });
    expect(notes.map((n) => n.version)).toEqual(['1.10.0', '1.9.0', '1.2.0']);
  });

  it('ignores files that are not versioned notes', () => {
    const { notes, errors } = loadReleaseNotes({
      '../../../release-notes/README.md': '# How to write a note',
      '../../../release-notes/1.0.0.md': raw('1.0.0', '2026-01-01'),
    });
    expect(notes.map((n) => n.version)).toEqual(['1.0.0']);
    expect(errors).toEqual([]);
  });

  it('collects a malformed note instead of throwing', () => {
    const { notes, errors } = loadReleaseNotes({
      '../../../release-notes/1.0.0.md': raw('1.0.0', '2026-01-01'),
      '../../../release-notes/2.0.0.md': 'no frontmatter here',
    });
    expect(notes.map((n) => n.version)).toEqual(['1.0.0']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('2.0.0.md');
  });
});

describe('unseenReleaseNotes', () => {
  const notes = [note('1.2.0', '2026-03-01'), note('1.1.0', '2026-02-01')];

  it('returns releases newer than the one the user last read', () => {
    expect(unseenReleaseNotes(notes, '1.1.0', '2026-01-01').map((n) => n.version)).toEqual([
      '1.2.0',
    ]);
  });

  it('returns nothing when the user has read the newest', () => {
    expect(unseenReleaseNotes(notes, '1.2.0', '2026-01-01')).toEqual([]);
  });

  it('ignores an account older than every release once a version is recorded', () => {
    expect(unseenReleaseNotes(notes, '1.0.0', '2020-01-01')).toHaveLength(2);
  });

  describe('a user who has never opened the page', () => {
    it('sees only releases published after they signed up', () => {
      expect(unseenReleaseNotes(notes, null, '2026-02-15').map((n) => n.version)).toEqual([
        '1.2.0',
      ]);
    });

    it('sees nothing when they signed up after the newest release', () => {
      expect(unseenReleaseNotes(notes, null, '2026-04-01')).toEqual([]);
    });

    it('treats a release shipped on their signup day as already present', () => {
      expect(unseenReleaseNotes(notes, null, '2026-03-01T09:00:00.000Z')).toEqual([]);
    });

    it('stays quiet when the signup date is unknown or unparseable', () => {
      expect(unseenReleaseNotes(notes, null, null)).toEqual([]);
      expect(unseenReleaseNotes(notes, null, 'not a date')).toEqual([]);
    });
  });
});
