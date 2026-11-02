/**
 * Unit tests for media-library-core (server/media-library-core.js): what the
 * media library and profile Feed leave out.
 */
import { describe, it, expect } from 'vitest';

import { excludingPostMedia, mediaRefsOf, uploadUrlsIn } from '../server/media-library-core';

const ITEM = 'a'.repeat(24);
const VIDEO = '0b8e2c1a-3f4d-4e5a-9b6c-7d8e9f0a1b2c';

describe('excludingPostMedia', () => {
  it('leaves out media posts carry, by item id or video id', () => {
    expect(excludingPostMedia({ mediaIds: new Set([ITEM, VIDEO]) })).toEqual({
      _id: { $nin: [ITEM] },
      videoid: { $nin: [VIDEO] },
    });
  });

  it("leaves out uploads a post shows only in its text (a plan's screenshot a wrap-up replaced)", () => {
    expect(excludingPostMedia({ urls: new Set(['/uploads/media/u1-ab.png']) })).toEqual({
      url: { $nin: ['/uploads/media/u1-ab.png'] },
    });
  });

  it('leaves out nothing when posts reference nothing', () => {
    expect(excludingPostMedia({})).toEqual({});
  });
});

describe('uploadUrlsIn', () => {
  it("reads each upload's path out of a post's Markdown, full URL or not", () => {
    const text = 'Plan ![shot.png](http://localhost:3100/uploads/media/u1-ab.png) and [doc](/uploads/media/u1-cd.pdf).';
    expect(uploadUrlsIn(text)).toEqual(['/uploads/media/u1-ab.png', '/uploads/media/u1-cd.pdf']);
  });

  it('is empty for text without uploads, or no text', () => {
    expect(uploadUrlsIn('Just words /uploads/other/x.png')).toEqual([]);
    expect(uploadUrlsIn(undefined)).toEqual([]);
  });
});

describe('mediaRefsOf', () => {
  it("is every id a post's attachment may name a user's media by: the item's own, or its video's", () => {
    const items = [{ _id: { toHexString: () => ITEM } }, { _id: { toHexString: () => 'b'.repeat(24) }, videoid: VIDEO }];
    expect(mediaRefsOf(items)).toEqual([ITEM, 'b'.repeat(24), VIDEO]);
  });
});
