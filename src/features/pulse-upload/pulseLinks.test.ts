import { buildUploadLink, PULSE_OPEN_URL as PACKAGE_OPEN_URL } from '@mieweb/pulsevault/core';
import { describe, expect, it } from 'vitest';

import { buildPulseLink, PULSE_OPEN_URL, pulseServerBase } from './pulseLinks';

const videoid = '11111111-2222-3333-4444-555555555555';
const uploadToken = 'fake-capability-token';

describe('pulseServerBase', () => {
  it('appends the /pulsevault mount prefix to the backend origin', () => {
    expect(pulseServerBase()).toMatch(/\/pulsevault$/);
  });
});

describe('buildPulseLink', () => {
  it("is exactly @mieweb/pulsevault's https pairing link", () => {
    expect(PULSE_OPEN_URL).toBe(PACKAGE_OPEN_URL);
    expect(buildPulseLink(videoid, uploadToken)).toBe(
      buildUploadLink({
        server: pulseServerBase(),
        token: uploadToken,
        artifactId: videoid,
        form: 'https',
      }),
    );
  });

  it('carries the upload in the fragment, so the link host never receives the token', () => {
    const url = new URL(buildPulseLink(videoid, uploadToken));
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
