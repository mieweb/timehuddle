import { describe, expect, it } from 'vitest';

import { splitLinks } from './linkify';

describe('splitLinks', () => {
  it('leaves text without a link as one plain part', () => {
    expect(splitLinks('Forgot to clock out.')).toEqual([{ text: 'Forgot to clock out.' }]);
  });

  it('turns each http(s) URL into a link and keeps the text around it', () => {
    expect(splitLinks('See https://loom.com/share/abc and http://x.dev now')).toEqual([
      { text: 'See ' },
      { text: 'https://loom.com/share/abc', href: 'https://loom.com/share/abc' },
      { text: ' and ' },
      { text: 'http://x.dev', href: 'http://x.dev' },
      { text: ' now' },
    ]);
  });

  it('leaves sentence punctuation out of the link', () => {
    expect(splitLinks('Recording: https://youtu.be/abc.')).toEqual([
      { text: 'Recording: ' },
      { text: 'https://youtu.be/abc', href: 'https://youtu.be/abc' },
      { text: '.' },
    ]);
    expect(splitLinks('(see https://x.dev/a)')).toEqual([
      { text: '(see ' },
      { text: 'https://x.dev/a', href: 'https://x.dev/a' },
      { text: ')' },
    ]);
  });

  it('keeps a bracket that belongs to the URL', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(splitLinks(url)).toEqual([{ text: url, href: url }]);
  });

  it('only links http and https, so a javascript: URL stays text', () => {
    expect(splitLinks('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });

  it('joins back into the original text', () => {
    const text = 'a https://x.dev/1, b\nhttps://y.dev/2!';
    expect(
      splitLinks(text)
        .map((p) => p.text)
        .join(''),
    ).toBe(text);
  });
});
