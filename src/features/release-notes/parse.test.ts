import { describe, expect, it } from 'vitest';

import { parseReleaseNote, versionFromFilename } from './parse';

const VALID = `---
version: 1.2.3
date: 2026-09-18
title: A headline
---

The body.
`;

describe('versionFromFilename', () => {
  it('reads the version out of a note filename', () => {
    expect(versionFromFilename('1.2.3.md')).toBe('1.2.3');
    expect(versionFromFilename('1.2.3-beta.1.md')).toBe('1.2.3-beta.1');
  });

  it('rejects files that are not releases', () => {
    expect(versionFromFilename('README.md')).toBeNull();
    expect(versionFromFilename('draft.md')).toBeNull();
    expect(versionFromFilename('1.2.md')).toBeNull();
  });
});

describe('parseReleaseNote', () => {
  it('parses frontmatter and body', () => {
    const note = parseReleaseNote('1.2.3.md', VALID);
    expect(note).toEqual({
      version: '1.2.3',
      date: '2026-09-18',
      title: 'A headline',
      body: 'The body.',
    });
  });

  it('tolerates CRLF line endings', () => {
    const note = parseReleaseNote('1.2.3.md', VALID.replace(/\n/g, '\r\n'));
    expect(note.title).toBe('A headline');
    expect(note.body).toBe('The body.');
  });

  it('keeps a colon inside a title', () => {
    const raw = VALID.replace('title: A headline', 'title: Clocking in: now one tap');
    expect(parseReleaseNote('1.2.3.md', raw).title).toBe('Clocking in: now one tap');
  });

  it.each([
    ['a filename that is not a version', 'notes.md', VALID],
    ['no frontmatter', '1.2.3.md', 'Just a body.'],
    ['a missing version', '1.2.3.md', VALID.replace('version: 1.2.3\n', '')],
    ['a missing date', '1.2.3.md', VALID.replace('date: 2026-09-18\n', '')],
    ['a missing title', '1.2.3.md', VALID.replace('title: A headline\n', '')],
    ['a non-semver version', '1.2.3.md', VALID.replace('version: 1.2.3', 'version: next')],
    ['a date in the wrong format', '1.2.3.md', VALID.replace('2026-09-18', '09/18/2026')],
    ['a date that is not real', '1.2.3.md', VALID.replace('2026-09-18', '2026-13-45')],
    ['an empty body', '1.2.3.md', VALID.replace('The body.\n', '')],
  ])('rejects %s', (_label, fileName, raw) => {
    expect(() => parseReleaseNote(fileName, raw)).toThrow();
  });

  it('rejects a version that disagrees with the filename', () => {
    expect(() => parseReleaseNote('1.2.4.md', VALID)).toThrow(/declares version "1\.2\.3"/);
  });

  describe('heading levels', () => {
    const withHeadings = (body: string) => parseReleaseNote('1.2.3.md', VALID + body).body;

    it('pushes body headings down one level so they nest under the release title', () => {
      expect(withHeadings('\n# Top\n\n## Section\n\n### Detail\n')).toContain('## Top');
      expect(withHeadings('\n## Section\n')).toContain('### Section');
      expect(withHeadings('\n### Detail\n')).toContain('#### Detail');
    });

    it('stops at h6 rather than emitting an h7', () => {
      expect(withHeadings('\n###### Deepest\n')).toContain('###### Deepest');
    });

    it('leaves headings inside fenced code alone', () => {
      const body = withHeadings('\n```bash\n# not a heading\n```\n\n## Section\n');
      expect(body).toContain('# not a heading');
      expect(body).toContain('### Section');
    });

    it('leaves a lone hash that is not a heading alone', () => {
      expect(withHeadings('\nIssue #445 is fixed.\n')).toContain('Issue #445 is fixed.');
    });
  });

  describe('asset paths', () => {
    const withImage = VALID.replace(
      'The body.',
      '![Clocking in](assets/1.2.3/clock-in.png)\n\nAnd [a doc](https://example.com/x.png).',
    );

    it('rewrites them to their bundled URLs', () => {
      const note = parseReleaseNote('1.2.3.md', withImage, (path) =>
        path === 'assets/1.2.3/clock-in.png' ? '/assets/clock-in.hashed.png' : null,
      );
      expect(note.body).toContain('![Clocking in](/assets/clock-in.hashed.png)');
    });

    it('leaves absolute URLs alone', () => {
      const note = parseReleaseNote('1.2.3.md', withImage, () => '/assets/clock-in.hashed.png');
      expect(note.body).toContain('[a doc](https://example.com/x.png)');
    });

    it('rejects a reference to an asset that does not exist', () => {
      expect(() => parseReleaseNote('1.2.3.md', withImage, () => null)).toThrow(
        /assets\/1\.2\.3\/clock-in\.png.*does not exist/,
      );
    });
  });
});
