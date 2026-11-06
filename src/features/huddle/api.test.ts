import { describe, expect, it, vi } from 'vitest';

import { uploadVideoTo } from '../pulse-upload/videoFile';

import { uploadMedia } from './api';

const media = vi.hoisted(() => ({
  uploadImage: vi.fn(),
  discardUpload: vi.fn(async () => {}),
}));
vi.mock('@lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/api')>()),
  mediaApi: media,
}));

vi.mock('../pulse-upload/videoFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pulse-upload/videoFile')>()),
  uploadVideoTo: vi.fn(async () => 'video-1'),
}));

describe('uploadMedia', () => {
  it("sends a video file as the post's own, not into the library", async () => {
    const file = new File(['x'], 'standup.mov', { type: 'video/quicktime' });

    const item = await uploadMedia(file);

    expect(uploadVideoTo).toHaveBeenCalledWith({ kind: 'post' }, file, undefined, undefined);
    expect(item).toMatchObject({
      id: 'video-1',
      type: 'video',
      url: '/pulsevault/artifacts/video-1',
    });
  });

  it('takes back a photo cancelled once its bytes were in', async () => {
    media.uploadImage.mockResolvedValueOnce({
      id: 'm-photo',
      type: 'image',
      url: '/uploads/media/x.png',
    });
    const controller = new AbortController();
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const sent = uploadMedia(file, undefined, controller.signal);
    controller.abort();
    await expect(sent).rejects.toMatchObject({ name: 'AbortError' });
    expect(media.discardUpload).toHaveBeenCalledWith({ mediaId: 'm-photo' });
  });
});
