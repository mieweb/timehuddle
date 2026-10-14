import { describe, expect, it } from 'vitest';

import { guides, guidesBySection, loadGuides, parseGuide } from './guides';

const guide = (fields: string, body = 'Body.') => `---\n${fields}\n---\n\n${body}\n`;

describe('guides', () => {
  it('parses a well-formed guide', () => {
    expect(
      parseGuide(
        'clock-in.md',
        guide('title: Clock in\nsummary: Start a shift.\nsection: Using it\norder: 2'),
      ),
    ).toEqual({
      slug: 'clock-in',
      title: 'Clock in',
      summary: 'Start a shift.',
      section: 'Using it',
      order: 2,
      body: 'Body.',
    });
  });

  it('rejects a guide with a missing field or a bad filename', () => {
    expect(() => parseGuide('a.md', guide('title: A\nsection: S\norder: 1'))).toThrow(/summary/);
    expect(() => parseGuide('Clock In.md', guide('title: A'))).toThrow(/filenames/);
  });

  it('sorts by order and skips the folder README', () => {
    const list = loadGuides({
      'guides/README.md': '# not a guide',
      'guides/b.md': guide('title: B\nsummary: b\nsection: Two\norder: 2'),
      'guides/a.md': guide('title: A\nsummary: a\nsection: One\norder: 1'),
    });
    expect(list.map((g) => g.slug)).toEqual(['a', 'b']);
    expect(guidesBySection(list).map((g) => g.section)).toEqual(['One', 'Two']);
  });

  it('loads every guide in the real folder', () => {
    expect(guides.length).toBeGreaterThan(0);
    expect(new Set(guides.map((g) => g.slug)).size).toBe(guides.length);
  });
});
