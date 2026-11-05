import { describe, expect, it, vi } from 'vitest';

import { uploadVideoTo } from '../pulse-upload/videoFile';

import { uploadMedia } from './api';

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
});
