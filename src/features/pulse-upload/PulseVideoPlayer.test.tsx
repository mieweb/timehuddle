import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@mieweb/ui';

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

  it('starts afresh when the host swaps in another video', async () => {
    const OTHER = '1c8f8d2f-6b40-4d2e-8f3b-7a2e3d4c5b6a';
    const { container, rerender } = render(<PulseVideoPlayer video={VIDEO} />);
    // The first video has no thumbnail, however long it's looked for.
    fireEvent.error(poster(container)!);
    for (const delay of POSTER_RETRY_MS) {
      await act(() => vi.advanceTimersByTimeAsync(delay));
      act(() => probes[probes.length - 1].onerror?.());
    }
    expect(placeholder(container)).not.toBeNull();

    rerender(<PulseVideoPlayer video={OTHER} />);

    expect(poster(container)?.getAttribute('src')).toBe(`/pulsevault/artifacts/${OTHER}/poster`);
  });
});

describe('PulseVideoPlayer play and expand', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('plays in the card, and its expand button opens the host’s larger view', () => {
    const onOpen = vi.fn();
    const { container, getByRole } = render(
      <PulseVideoPlayer video={VIDEO} title="Demo" onOpen={onOpen} launchId="launch-1" />,
    );
    const expand = getByRole('button', { name: 'Open Demo larger' });
    // Back from the larger view returns focus here.
    expect(expand.getAttribute('data-media-launch-id')).toBe('launch-1');
    fireEvent.click(expand);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(getByRole('button', { name: 'Play Demo' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pulse-video-player video')).not.toBeNull();
    // Playing, the player's own controls (full screen among them) take over.
    expect(container.querySelector('.pulse-video-expand')).toBeNull();
  });

  it('lets a tap on the name’s gradient through to Play; only the name is the editor’s', () => {
    const { container } = render(
      <ToastProvider>
        <PulseVideoPlayer video={VIDEO} title="Demo" renamable />
      </ToastProvider>,
    );
    const overlay = container.querySelector('.pulse-video-name')!;
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.className).toContain('*:pointer-events-auto');
  });

  it('has no expand button where there is no larger view', () => {
    const { container } = render(<PulseVideoPlayer video={VIDEO} title="Demo" />);
    expect(container.querySelector('.pulse-video-expand')).toBeNull();
  });
});
