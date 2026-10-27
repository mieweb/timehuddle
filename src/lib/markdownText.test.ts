import { describe, expect, it } from 'vitest';

import { PREVIEW_SOURCE_CHARS, stripMarkdown } from './markdownText';

describe('stripMarkdown', () => {
  it('drops the syntax and keeps the words, on one line', () => {
    expect(stripMarkdown('## Plan\n- **Fix** the [login](https://x.dev) bug\n- ship _it_')).toBe(
      'Plan - Fix the login bug - ship it',
    );
  });

  it('keeps an image or attachment link by its label', () => {
    expect(stripMarkdown('Demo [📎 clip.mov](/pulsevault/artifacts/1) ![shot](a.png)')).toBe(
      'Demo 📎 clip.mov shot',
    );
  });

  it('removes code', () => {
    expect(stripMarkdown('run `npm test` then\n```\nnpm run build\n```')).toBe('run  then');
  });

  it('strips a long post full of unmatched brackets without stalling', () => {
    const post = `Plan ${'[x'.repeat(100_000)} ${'[a]('.repeat(100_000)}`;
    const started = performance.now();
    expect(stripMarkdown(post).startsWith('Plan [x[x')).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('reads only as much as a preview can show', () => {
    expect(stripMarkdown('a'.repeat(PREVIEW_SOURCE_CHARS + 500))).toHaveLength(
      PREVIEW_SOURCE_CHARS,
    );
  });
});
