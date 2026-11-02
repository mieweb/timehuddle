/**
 * Unit tests for media-library-core (server/media-library-core.js): what the
 * media library and profile Feed leave out.
 */
import { describe, it, expect } from 'vitest';

import { excludingPostMedia, ownUploadsAmong, uploadIdsOf, uploadUrlsIn } from '../server/media-library-core';

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

  it('reads the path without a query or fragment, so it matches the item', () => {
    expect(uploadUrlsIn('See [p2](/uploads/media/u1-cd.pdf#page=2) and ![x](/uploads/media/u1-ab.png?v=3)')).toEqual([
      '/uploads/media/u1-cd.pdf',
      '/uploads/media/u1-ab.png',
    ]);
  });

  it('is empty for text without uploads, or no text', () => {
    expect(uploadUrlsIn('Just words /uploads/other/x.png')).toEqual([]);
    expect(uploadUrlsIn(undefined)).toEqual([]);
  });
});

describe("a user's media on others' posts", () => {
  const OTHER = 'b'.repeat(24);
  const items = [{ _id: { toHexString: () => ITEM } }, { _id: { toHexString: () => OTHER }, videoid: VIDEO }];

  it("looks them up by each item's own id only, never its Pulse video's", () => {
    expect(uploadIdsOf(items)).toEqual([ITEM, OTHER]);
  });

  it("counts an upload someone else's post carries by its own id (an admin's edit)", () => {
    expect(ownUploadsAmong(items, [ITEM, 'c'.repeat(24)])).toEqual([ITEM]);
  });

  it("doesn't count a share of their public Pulse video, so it stays in their library", () => {
    const ids = ownUploadsAmong(items, [VIDEO, 'c'.repeat(24)]);
    expect(ids).toEqual([]);
    expect(excludingPostMedia({ mediaIds: new Set(ids) })).toEqual({});
  });
});
