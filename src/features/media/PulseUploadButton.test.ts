import { describe, expect, it } from 'vitest';

import { buildUploadDeepLink, pulseServerBase } from './PulseUploadButton';

describe('pulseServerBase', () => {
  it('appends the /pulsevault mount prefix to the backend origin', () => {
    expect(pulseServerBase()).toMatch(/\/pulsevault$/);
  });
});

describe('buildUploadDeepLink', () => {
  it('encodes the @mieweb/pulsevault deep-link protocol', () => {
    const videoid = '11111111-2222-3333-4444-555555555555';
    const uploadToken = 'fake-capability-token';
    const link = buildUploadDeepLink(videoid, uploadToken);

    expect(link.startsWith('pulsecam://?')).toBe(true);
    const params = new URL(link.replace('pulsecam://?', 'https://x/?')).searchParams;
    expect(params.get('v')).toBe('1');
    expect(params.get('artifactId')).toBe(videoid);
    expect(params.get('server')).toBe(pulseServerBase());
    expect(params.get('token')).toBe(uploadToken);
    expect(params.get('uploadUnit')).toBe('merged');
    // Legacy param names must not leak back in.
    expect(params.has('mode')).toBe(false);
    expect(params.has('videoid')).toBe(false);
  });
});
