import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadMedia } from './api';
import { useAttachmentUpload } from './useAttachmentUpload';

vi.mock('./api', () => ({ uploadMedia: vi.fn() }));

const mockUploadMedia = vi.mocked(uploadMedia);

const MB = 1024 * 1024;

/** A file that reports `size` without allocating it. */
function sizedFile(name: string, type: string, size: number) {
  const file = new File([''], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('useAttachmentUpload', () => {
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
    const onAttachmentAdd = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useAttachmentUpload({ onAttachmentAdd, onError }));
    return { upload: result.current.upload, onAttachmentAdd, onError };
  }

  it('sends a video over 100 MB, since videos go to PulseVault and take up to 500 MB', async () => {
    const { upload, onError } = setup();
    const clip = sizedFile('clip.mov', 'video/quicktime', 300 * MB);

    await act(() => upload([clip]));

    expect(mockUploadMedia).toHaveBeenCalledWith(clip, expect.any(Function));
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('too large'));
  });

  it('turns away a video over 500 MB and a document over 100 MB, each with its own limit', async () => {
    const { upload, onError } = setup();
    const clip = sizedFile('long.mp4', 'video/mp4', 501 * MB);
    const doc = sizedFile('scan.pdf', 'application/pdf', 101 * MB);

    await act(() => upload([clip, doc]));

    expect(mockUploadMedia).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      'long.mp4 — too large to attach (limit 500.0 MB). ' +
        'scan.pdf — too large to attach (limit 100.0 MB).',
    );
  });
});
