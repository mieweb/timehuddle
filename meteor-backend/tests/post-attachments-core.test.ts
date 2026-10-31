/**
 * Unit tests for post-attachments-core (server/post-attachments-core.js): what
 * a Huddle post may carry.
 */
import { describe, it, expect } from 'vitest';

import { AttachmentError, cleanPostAttachments } from '../server/post-attachments-core';
import { videoIdOf } from '../server/video-names-core';

const ME = 'user-me';
const VIDEO = '0b8e2c1a-3f4d-4e5a-9b6c-7d8e9f0a1b2c';
const MINE = {
  _id: 'a'.repeat(24),
  userId: ME,
  url: '/uploads/media/mine.png',
  mimeType: 'image/png',
  title: 'whiteboard.png',
  size: 2048,
};
const THEIRS = { ...MINE, _id: 'b'.repeat(24), userId: 'someone-else', url: '/uploads/media/theirs.pdf' };

const clean = (attachments: unknown, existing: unknown[] = []) =>
  cleanPostAttachments({
    attachments,
    userId: ME,
    mediaById: new Map([MINE, THEIRS].map((item) => [item._id, item])),
    pulseVideoOf: (url: string) => videoIdOf(url, ['http://localhost:3100']),
    existing,
  });

describe('cleanPostAttachments', () => {
  it("stores the poster's own upload from its media item, size included", () => {
    expect(
      clean([{ mediaId: MINE._id, type: 'file', url: 'http://localhost:3100/uploads/media/mine.png', filename: 'x' }]),
    ).toEqual([
      { mediaId: MINE._id, type: 'image', url: '/uploads/media/mine.png', filename: 'whiteboard.png', size: 2048 },
    ]);
  });

  it("keeps an image's measured size, if it's sane", () => {
    const [kept] = clean([{ mediaId: MINE._id, type: 'image', url: MINE.url, width: 800, height: 600 }]);
    expect(kept).toMatchObject({ width: 800, height: 600 });
    const [dropped] = clean([{ mediaId: MINE._id, type: 'image', url: MINE.url, width: -1, height: 'x' }]);
    expect(dropped).not.toHaveProperty('width');
  });

  it('takes a Pulse video, whoever uploaded it', () => {
    expect(clean([{ mediaId: VIDEO, type: 'video', url: `/pulsevault/artifacts/${VIDEO}`, filename: 'Demo' }])).toEqual([
      { mediaId: VIDEO, type: 'video', url: `/pulsevault/artifacts/${VIDEO}`, filename: 'Demo' },
    ]);
  });

  it("refuses someone else's upload, a made-up URL, and a mismatched one", () => {
    expect(() => clean([{ mediaId: THEIRS._id, type: 'file', url: THEIRS.url }])).toThrow(AttachmentError);
    expect(() => clean([{ mediaId: 'x', type: 'image', url: 'https://evil.example/a.png' }])).toThrow(AttachmentError);
    expect(() => clean([{ mediaId: MINE._id, type: 'image', url: THEIRS.url }])).toThrow(AttachmentError);
    expect(() => clean([{ mediaId: MINE._id, type: 'script', url: MINE.url }])).toThrow(AttachmentError);
    expect(() => clean('nope')).toThrow(AttachmentError);
  });

  it('keeps an attachment the post already carries, as it is', () => {
    const existing = [{ mediaId: THEIRS._id, type: 'file', url: THEIRS.url, filename: 'theirs.pdf' }];
    expect(clean([{ mediaId: THEIRS._id, type: 'file', url: `http://localhost:3100${THEIRS.url}` }], existing)).toEqual(
      existing,
    );
  });
});
