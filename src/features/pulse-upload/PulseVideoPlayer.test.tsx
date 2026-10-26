import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POSTER_RETRY_MS, PulseVideoPlayer } from './PulseVideoPlayer';

vi.mock('@lib/api', () => ({ resolveMediaUrl: (path: string) => path }));

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

/** Every background look for the poster, answered when the test says. */
const probes: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> =
  [];

describe('PulseVideoPlayer poster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    probes.length = 0;
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          probes.push(this);
        }
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const poster = (container: HTMLElement) =>
    container.querySelector<HTMLImageElement>('.pulse-video-poster-image');
  const placeholder = (container: HTMLElement) =>
    container.querySelector('.pulse-video-poster-placeholder');

  it('shows a thumbnail that arrives after the card first asked for it', async () => {
    const { container } = render(<PulseVideoPlayer video={VIDEO} />);
    fireEvent.error(poster(container)!);
    expect(placeholder(container)).not.toBeNull();

    // Not there on the first look again either.
    await act(() => vi.advanceTimersByTimeAsync(POSTER_RETRY_MS[0]));
    expect(probes).toHaveLength(1);
    expect(probes[0].src).toBe(`/pulsevault/artifacts/${VIDEO}/poster?attempt=1`);
    act(() => probes[0].onerror?.());
    expect(placeholder(container)).not.toBeNull();

    // There on the next.
    await act(() => vi.advanceTimersByTimeAsync(POSTER_RETRY_MS[1]));
    expect(probes).toHaveLength(2);
    act(() => probes[1].onload?.());
    expect(poster(container)?.getAttribute('src')).toBe(
      `/pulsevault/artifacts/${VIDEO}/poster?attempt=2`,
    );
  });

  it('keeps the plain box for a video with no thumbnail, after a bounded number of looks', async () => {
    const { container } = render(<PulseVideoPlayer video={VIDEO} />);
    fireEvent.error(poster(container)!);
    for (const delay of POSTER_RETRY_MS) {
      await act(() => vi.advanceTimersByTimeAsync(delay));
      act(() => probes[probes.length - 1].onerror?.());
    }
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));

    expect(probes).toHaveLength(POSTER_RETRY_MS.length);
    expect(placeholder(container)).not.toBeNull();
  });
});
