import { buildUploadLink, PULSE_OPEN_URL as PACKAGE_OPEN_URL } from '@mieweb/pulsevault/core';
import { describe, expect, it } from 'vitest';

import {
  buildPulseLink,
  PULSE_LINK_APP,
  PULSE_OPEN_URL,
  pulseReturnPath,
  pulseServerBase,
} from './pulseLinks';

const videoid = '11111111-2222-3333-4444-555555555555';
const uploadToken = 'fake-capability-token';
const reservation = { videoid, uploadToken };
const returnUrl = 'https://huddle.example.org/app/tickets/abc?team=t1';

/** A link's fragment params. */
const paramsOf = (link: string) => new URLSearchParams(new URL(link).hash.slice(1));

describe('pulseServerBase', () => {
  it('appends the /pulsevault mount prefix to the backend origin', () => {
    expect(pulseServerBase()).toMatch(/\/pulsevault$/);
  });
});

describe('buildPulseLink', () => {
  it("is exactly @mieweb/pulsevault's https pairing link", () => {
    expect(PULSE_OPEN_URL).toBe(PACKAGE_OPEN_URL);
    expect(buildPulseLink(reservation)).toBe(
      buildUploadLink({
        server: pulseServerBase(),
        token: uploadToken,
        artifactId: videoid,
        form: 'https',
      }),
    );
  });

  it('carries the upload in the fragment, so the link host never receives the token', () => {
    const url = new URL(buildPulseLink(reservation));
    expect(`${url.origin}${url.pathname}`).toBe(PULSE_OPEN_URL);
    expect(url.search).toBe('');
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get('v')).toBe('1');
    expect(params.get('artifactId')).toBe(videoid);
    expect(params.get('server')).toBe(pulseServerBase());
    expect(params.get('token')).toBe(uploadToken);
    // Legacy param names must not leak back in.
    expect(params.has('mode')).toBe(false);
    expect(params.has('videoid')).toBe(false);
  });
});

describe('buildPulseLink with hints', () => {
  const place = {
    ...reservation,
    ref: 'Zm9vYmFyYmF6cXV4MQ',
    label: 'Platform · Huddle',
    name: 'Huddle update',
  };

  /**
   * @mieweb/pulsevault's own link for the same reservation: the QR's, or with
   * `way` the one opened on the phone itself.
   */
  const packageLink = (
    { label, name }: { label?: string; name?: string },
    way?: { returnUrl?: string },
    form: 'https' | 'pulsecam' = 'https',
  ) =>
    buildUploadLink({
      server: pulseServerBase(),
      artifactId: videoid,
      token: uploadToken,
      label,
      name,
      ...(way ? { app: PULSE_LINK_APP, ...way } : {}),
      form,
    });

  it("is exactly @mieweb/pulsevault's link, for a QR and for the phone itself", () => {
    expect(buildPulseLink(place)).toBe(packageLink(place));
    expect(buildPulseLink(place, returnUrl)).toBe(packageLink(place, { returnUrl }));
  });

  it("carries the same parameters as the package's other form of the link (pulsecam://)", () => {
    const [, params] = buildPulseLink(place, returnUrl).split('#');
    expect(params).toBe(packageLink(place, { returnUrl }, 'pulsecam').split('?')[1]);
  });

  it('names the place and the recording on a QR link, and nothing more', () => {
    const params = paramsOf(buildPulseLink(place));
    expect(params.get('artifactId')).toBe(videoid);
    expect(params.get('token')).toBe(uploadToken);
    expect(params.get('label')).toBe('Platform · Huddle');
    expect(params.get('name')).toBe('Huddle update');
    expect([...params.keys()]).toEqual(['v', 'artifactId', 'server', 'token', 'label', 'name']);
  });

  it('never puts the ref on the link: Pulse reads it from the token', () => {
    expect(paramsOf(buildPulseLink(place)).has('ref')).toBe(false);
    expect(paramsOf(buildPulseLink(place, returnUrl)).has('ref')).toBe(false);
  });

  it('also says who sent it and the way back, on a link opened on the phone itself', () => {
    const params = paramsOf(buildPulseLink(place, returnUrl));
    expect(params.get('app')).toBe('TimeHuddle');
    expect(params.get('return')).toBe(returnUrl);
  });

  it('carries no name when the reservation has none: the new recording is unnamed', () => {
    const { name: _name, ...unnamed } = place;
    expect(paramsOf(buildPulseLink(unnamed)).has('name')).toBe(false);
  });

  it('is the plain link for a reservation with no hints', () => {
    expect(buildPulseLink(reservation)).toBe(
      `${PULSE_OPEN_URL}#${new URLSearchParams({ v: '1', artifactId: videoid, server: pulseServerBase(), token: uploadToken })}`,
    );
  });

  describe('cleans a label and a name as the package does', () => {
    const FAMILY = '👨‍👩‍👧‍👦';
    it.each([
      ['a long one', `  ${'é'.repeat(90)}  `],
      ['line breaks and tabs', 'Fix\r\nthe\tlogin\u0000 page'],
      ['a line or paragraph separator', 'one two three'],
      ['text that reorders what is shown beside it', '‮gnp.exe‬ ⁦safe⁩'],
      ['nothing to show', ' ​‎‮ '],
      ['emoji sequences, cut at a whole one', FAMILY.repeat(30)],
      ['accents written as their own characters', 'é'.repeat(90)],
      ['flags', '🇮🇳'.repeat(50)],
    ])('%s', (_what, text) => {
      const dirty = { ...place, label: text, name: text };
      expect(buildPulseLink(dirty)).toBe(packageLink(dirty));
      expect(buildPulseLink(dirty, returnUrl)).toBe(packageLink(dirty, { returnUrl }));
    });

    it('to one line of plain text, cut at a whole character', () => {
      const params = (text: string) => paramsOf(buildPulseLink({ ...place, label: text }));
      expect(params('Fix\r\nthe\tlogin').get('label')).toBe('Fix the login');
      expect(params('‮gnp.exe‬').get('label')).toBe('gnp.exe');
      expect(params(' ​‎ ').has('label')).toBe(false);
      expect(Array.from(params('é'.repeat(90)).get('label') ?? '')).toHaveLength(60);
      // A family is seven characters: eight of them fit in 60, not eight and a half.
      expect(params(FAMILY.repeat(30)).get('label')).toBe(FAMILY.repeat(8));
    });
  });

  describe('the way back', () => {
    it.each([
      'https://huddle.example.org',
      'https://huddle.example.org/app/tickets?team=t1',
      ' https://HUDDLE.example.org/app/été ',
      'http://localhost:3003/app/clock',
      'http://10.20.25.34:3003/app/tickets',
    ])('is written as the package writes %s', (way) => {
      expect(buildPulseLink(place, way)).toBe(packageLink(place, { returnUrl: way }));
      expect(paramsOf(buildPulseLink(place, way)).get('return')).toBe(new URL(way).href);
    });

    it("is left out when it's one the package refuses to put on a link", () => {
      const refused = [
        'http://example.org/app',
        'https://huddle.example.org@evil.example/app',
        'https://user:secret@huddle.example.org/app',
        `https://huddle.example.org/${'a'.repeat(600)}`,
        'javascript:alert(1)',
        'not a url',
      ];
      for (const way of refused) {
        expect(() => packageLink(place, { returnUrl: way })).toThrow();
        // Who sent it, still; just no way back.
        expect(buildPulseLink(place, way)).toBe(packageLink(place, {}));
      }
      expect(buildPulseLink(place, '  ')).toBe(packageLink(place, { returnUrl: '  ' }));
    });
  });
});

describe('pulseReturnPath', () => {
  it('is the page and the team it is scoped to, without the view state', () => {
    expect(
      pulseReturnPath({ pathname: '/app/tickets', search: '?team=t1&status=open&q=bug' }),
    ).toBe('/app/tickets?team=t1');
    expect(pulseReturnPath({ pathname: '/app/tickets/abc', search: '?token=secret' })).toBe(
      '/app/tickets/abc',
    );
    expect(pulseReturnPath({ pathname: '/app/clock', search: '' })).toBe('/app/clock');
  });

  it('never names another site', () => {
    expect(pulseReturnPath({ pathname: '//evil.example/app', search: '' })).toBe(
      '/evil.example/app',
    );
  });
});
