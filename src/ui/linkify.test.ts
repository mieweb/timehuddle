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

  it("leaves the sentence's bracket out when the URL has its own", () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(splitLinks(`(${url})`)).toEqual([
      { text: '(' },
      { text: url, href: url },
      { text: ')' },
    ]);
    expect(splitLinks(`(see ${url}).`)).toEqual([
      { text: '(see ' },
      { text: url, href: url },
      { text: ').' },
    ]);
  });

  it('drops an unmatched square or curly bracket, but keeps balanced ones', () => {
    expect(splitLinks('Recording [https://example.com/repro]')).toEqual([
      { text: 'Recording [' },
      { text: 'https://example.com/repro', href: 'https://example.com/repro' },
      { text: ']' },
    ]);
    expect(splitLinks('{https://example.com}')).toEqual([
      { text: '{' },
      { text: 'https://example.com', href: 'https://example.com' },
      { text: '}' },
    ]);
    const ipv6 = 'http://[::1]:8080/a[1]';
    expect(splitLinks(`see ${ipv6}.`)).toEqual([
      { text: 'see ' },
      { text: ipv6, href: ipv6 },
      { text: '.' },
    ]);
  });

  it('trims a long run of closing brackets in linear time', () => {
    const text = `https://x.dev/a${')'.repeat(50_000)}`;
    const started = performance.now();
    const parts = splitLinks(text);
    expect(performance.now() - started).toBeLessThan(200);
    expect(parts[0]).toEqual({ text: 'https://x.dev/a', href: 'https://x.dev/a' });
    expect(parts[1].text).toHaveLength(50_000);
  });

  it('links a scheme in any case', () => {
    expect(splitLinks('HTTPS://example.com/repro and Http://x.dev')).toEqual([
      { text: 'HTTPS://example.com/repro', href: 'HTTPS://example.com/repro' },
      { text: ' and ' },
      { text: 'Http://x.dev', href: 'Http://x.dev' },
    ]);
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
