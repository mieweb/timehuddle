import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discardMedia, uploadMedia } from './api';
import { useComposerUploads } from './useComposerUploads';

vi.mock('./api', () => ({ uploadMedia: vi.fn(), discardMedia: vi.fn(async () => {}) }));

const mockUploadMedia = vi.mocked(uploadMedia);
const mockDiscardMedia = vi.mocked(discardMedia);

const MB = 1024 * 1024;

/** A file that reports `size` without allocating it. */
function sizedFile(name: string, type: string, size: number) {
  const file = new File([''], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('useComposerUploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadMedia.mockImplementation(async (file) => ({
      id: file.name,
      type: 'video',
      url: `/pulsevault/artifacts/${file.name}`,
      size: file.size,
      filename: file.name,
    }));
  });

  function setup() {
    const onError = vi.fn();
    const { result } = renderHook(() => useComposerUploads({ onError }));
    return { result, onError };
  }

  it('starts uploading a video over 100 MB as soon as it is attached, since videos take up to 500 MB', () => {
    const { result, onError } = setup();
    const clip = sizedFile('clip.mov', 'video/quicktime', 300 * MB);

    act(() => void result.current.attach([clip]));

    expect(mockUploadMedia).toHaveBeenCalledWith(
      clip,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(result.current.items).toHaveLength(1);
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('too large'));
  });

  it('turns away a video over 500 MB and a document over 100 MB, each with its own limit', () => {
    const { result, onError } = setup();
    const clip = sizedFile('long.mp4', 'video/mp4', 501 * MB);
    const doc = sizedFile('scan.pdf', 'application/pdf', 101 * MB);

    act(() => void result.current.attach([clip, doc]));

    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      'long.mp4 — too large to attach (limit 500 MB). ' +
        'scan.pdf — too large to attach (limit 100 MB).',
    );
  });

  it('turns away a type the composer does not take, worded as Huddle says it', () => {
    const { result, onError } = setup();

    act(() => void result.current.attach([sizedFile('archive.zip', 'application/zip', MB)]));

    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      "archive.zip can't be attached. Photos, videos, PDFs, and Word, Excel or text files can.",
    );
  });

  it('cancels the upload of a file removed while it uploads', () => {
    mockUploadMedia.mockImplementation(() => new Promise(() => {}));
    const { result } = setup();

    act(() => void result.current.attach([sizedFile('clip.mp4', 'video/mp4', 10 * MB)]));
    const signal = mockUploadMedia.mock.calls[0][2] as AbortSignal;
    act(() => result.current.remove(result.current.items[0].id));

    expect(signal.aborted).toBe(true);
    expect(mockDiscardMedia).not.toHaveBeenCalled();
  });

  it('takes back a finished upload that is removed before posting', async () => {
    const { result } = setup();

    act(() => void result.current.attach([sizedFile('clip.mp4', 'video/mp4', 10 * MB)]));
    await act(async () => {
      await result.current.settle();
    });
    await act(async () => result.current.remove(result.current.items[0].id));

    expect(mockDiscardMedia).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'clip.mp4' }),
      expect.any(File),
    );
  });
});
