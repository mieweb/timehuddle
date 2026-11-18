import { describe, expect, it, vi } from 'vitest';

import { CAPTIONS_COPY, captionsOfMedia, trackProps } from './captions';

vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => `https://backend.test${path}`,
}));

const CAPTIONS = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('trackProps', () => {
  it('is a default English captions track for a video with captions', () => {
    expect(trackProps(`/pulsevault/artifacts/${CAPTIONS}`)).toEqual({
      kind: 'captions',
      src: `https://backend.test/pulsevault/artifacts/${CAPTIONS}`,
      label: 'Captions',
      default: true,
      srcLang: 'en',
    });
  });

  it('names the track from the strings module', () => {
    expect(trackProps(`/pulsevault/artifacts/${CAPTIONS}`)?.label).toBe(CAPTIONS_COPY.label);
  });

  it('is null for a video without captions, so no track and no empty captions button', () => {
    for (const none of [null, undefined, '']) {
      expect(trackProps(none)).toBeNull();
    }
  });

  it("is null for anything that isn't a PulseVault artifact", () => {
    for (const url of [
      'https://elsewhere.test/captions.vtt',
      '/uploads/captions.vtt',
      '/pulsevault/artifacts/not-an-id',
      `/pulsevault/artifacts/${CAPTIONS}/poster`,
      `https://elsewhere.test/page?next=/pulsevault/artifacts/${CAPTIONS}`,
    ]) {
      expect(trackProps(url)).toBeNull();
    }
  });

  it("plays an absolute captions URL from this backend's PulseVault, whatever host it named", () => {
    expect(trackProps(`https://old-host.test/pulsevault/artifacts/${CAPTIONS}`)?.src).toBe(
      `https://backend.test/pulsevault/artifacts/${CAPTIONS}`,
    );
  });
});

describe('captionsOfMedia', () => {
  const media = { id: 'v', kind: 'video' as const, src: '/pulsevault/artifacts/v' };

  it('reads the captions superChatFeed carries on a media item', () => {
    const path = `/pulsevault/artifacts/${CAPTIONS}`;
    expect(captionsOfMedia({ ...media, captionsUrl: path } as typeof media)).toBe(path);
  });

  it('is null for a media item without them', () => {
    expect(captionsOfMedia(media)).toBeNull();
    expect(captionsOfMedia({ ...media, captionsUrl: null } as typeof media)).toBeNull();
  });
});
