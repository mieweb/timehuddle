import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoPublicInfo } from '@lib/api';
import { WatchPage } from './WatchPage';

const publicInfo = vi.fn<(videoId: string) => Promise<VideoPublicInfo>>();

vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  videoApi: { publicInfo: (videoId: string) => publicInfo(videoId) },
}));

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';
const CAPTIONS = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function info(captionsUrl: string | null | undefined): VideoPublicInfo {
  return {
    videoId: VIDEO,
    name: 'Standup',
    addedAt: null,
    author: null,
    canRename: false,
    ...(captionsUrl === undefined ? {} : { captionsUrl }),
  };
}

describe('WatchPage captions', () => {
  beforeEach(() => {
    publicInfo.mockReset();
    document.title = '';
  });
  afterEach(cleanup);

  const video = () => screen.getByRole('article').querySelector<HTMLVideoElement>('video');

  it('plays a video that has captions with its captions track, asking for it with CORS', async () => {
    publicInfo.mockResolvedValue(info(`/pulsevault/artifacts/${CAPTIONS}`));
    render(<WatchPage videoId={VIDEO} />);
    await waitFor(() => expect(video()?.querySelector('track')).not.toBeNull());
    const track = video()!.querySelector('track')!;
    expect(track.getAttribute('kind')).toBe('captions');
    expect(track.getAttribute('src')).toBe(`/pulsevault/artifacts/${CAPTIONS}`);
    expect(track.getAttribute('srclang')).toBe('en');
    expect(track.getAttribute('label')).toBe('Captions');
    expect(track.hasAttribute('default')).toBe(true);
    expect(video()?.getAttribute('crossorigin')).toBe('anonymous');
    expect(video()?.getAttribute('src')).toBe(`/pulsevault/artifacts/${VIDEO}`);
  });

  it.each([
    ['null', null],
    ['absent (a server from before captions)', undefined],
  ])('adds no track when its captions are %s', async (_, captionsUrl) => {
    publicInfo.mockResolvedValue(info(captionsUrl));
    render(<WatchPage videoId={VIDEO} />);
    // Its details arrived (the page is titled with its name).
    await waitFor(() => expect(document.title).toBe('Standup · TimeHuddle'));
    expect(video()).not.toBeNull();
    expect(video()?.querySelector('track')).toBeNull();
    expect(video()?.hasAttribute('crossorigin')).toBe(false);
    expect(screen.queryByRole('button', { name: /captions/i })).toBeNull();
  });
});
