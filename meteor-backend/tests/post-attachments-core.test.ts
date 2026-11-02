/**
 * Unit tests for post-attachments-core (server/post-attachments-core.js): what
 * a Huddle post may carry.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  AttachmentError,
  cleanPostAttachments,
  DISCARD_GRACE_MS,
  discardMark,
  dueDiscards,
  keepForPost,
  keepForReference,
  markUnusedUploads,
  sweepDiscardedUploads,
  uploadUseQueries,
} from '../server/post-attachments-core';
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
    // cleanPostAttachments (plain JS) has no type for `existing`; TS infers it
    // from its own body (an empty-array default) as `never[]`.
    existing: existing as never[],
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

  it("keys a Pulse video by its own id, never a media id the client sent", () => {
    // Someone else's photo id paired with a Pulse URL would hide that photo
    // from its owner's library, as an item another post carries.
    const [video] = clean([{ mediaId: THEIRS._id, type: 'video', url: `/pulsevault/artifacts/${VIDEO}` }]);
    expect(video.mediaId).toBe(VIDEO);
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

  it('reads no list (`null`) as none, so clearing takes the same path as `[]`', () => {
    expect(clean(null)).toEqual([]);
  });

  it('keeps an attachment the post already carries, as it is', () => {
    const existing = [{ mediaId: THEIRS._id, type: 'file', url: THEIRS.url, filename: 'theirs.pdf' }];
    expect(clean([{ mediaId: THEIRS._id, type: 'file', url: `http://localhost:3100${THEIRS.url}` }], existing)).toEqual(
      existing,
    );
  });
});

describe('uploadUseQueries', () => {
  const queries = uploadUseQueries({ mediaId: MINE._id, url: MINE.url });
  const queryOn = (collection: string) => queries.find((q) => q.collection === collection)?.filter;
  /** Whether a `$regex` condition matches `text`, as Mongo would. */
  const matches = (condition: { $regex: string } | RegExp, text: string) =>
    (condition instanceof RegExp ? condition : new RegExp(condition.$regex)).test(text);

  it('looks for a Huddle post carrying the upload or showing it in its text', () => {
    const posts = queryOn('huddlePosts') as { $or: Record<string, unknown>[] };
    expect(posts.$or).toContainEqual({ 'attachments.mediaId': MINE._id });
    const text = posts.$or.find((c) => 'content.text' in c)!['content.text'] as { $regex: string };
    expect(matches(text, `Look ![shot](${MINE.url})`)).toBe(true);
  });

  it("looks for a ticket whose description links or embeds it, which isn't an attachment", () => {
    const tickets = queryOn('tickets') as { description: { $regex: string } };
    expect(tickets).toBeDefined();
    expect(matches(tickets.description, `Repro: ![](http://localhost:3100${MINE.url}) then [it](${MINE.url})`)).toBe(
      true,
    );
    expect(matches(tickets.description, 'Repro: /uploads/media/mineXpng')).toBe(false);
  });

  it('looks for an attachment at its URL, full or not', () => {
    const attachments = queryOn('attachments') as { url: RegExp };
    expect(matches(attachments.url, `http://localhost:3100${MINE.url}`)).toBe(true);
    expect(matches(attachments.url, `${MINE.url}.bak`)).toBe(false);
  });

  it('counts its URL with a query or fragment as the same upload', () => {
    const attachments = queryOn('attachments') as { url: RegExp };
    expect(matches(attachments.url, `${MINE.url}#page=2`)).toBe(true);
    expect(matches(attachments.url, `${MINE.url}?download=1`)).toBe(true);
    expect(matches(attachments.url, `${MINE.url}x?download=1`)).toBe(false);
  });
});

describe('discarding an upload a post dropped', () => {
  const NOW = new Date('2026-11-02T12:00:00Z');
  const later = (ms: number) => new Date(NOW.getTime() + ms);
  type Row = { _id: string; userId: string; filename: string; url?: string; discardAt?: Date };

  /** A media collection in memory, for just the filters these functions build. */
  function mediaRows(...rows: Row[]) {
    const byId = new Map(rows.map((row) => [row._id, { ...row }]));
    const removedFiles: string[] = [];
    return {
      byId,
      removedFiles,
      /** keepForPost's update: clear discardAt on the poster's marked items. */
      keepForPost(objectIds: string[], userId: string) {
        const { filter } = keepForPost({ objectIds, userId });
        for (const id of filter._id.$in) {
          const row = byId.get(id);
          if (row && row.userId === filter.userId && row.discardAt) delete row.discardAt;
        }
      },
      /** keepForReference's update: clear discardAt on the marked items at those URLs. */
      keepForReference(texts: unknown[]) {
        const kept = keepForReference(texts);
        if (!kept) return;
        for (const row of byId.values()) {
          if (row.url && kept.filter.url.$in.includes(row.url) && row.discardAt) delete row.discardAt;
        }
      },
      deps: (used: Set<string> = new Set()) => ({
        isUsed: async (item: Row) => used.has(item._id),
        keep: async (filter: { _id: string; discardAt: Date }) => {
          const row = byId.get(filter._id);
          if (row?.discardAt?.getTime() === filter.discardAt.getTime()) delete row.discardAt;
        },
        deleteRow: async (filter: { _id: string; discardAt: { $lte: Date } }) => {
          const row = byId.get(filter._id);
          if (!row?.discardAt || row.discardAt > filter.discardAt.$lte) return 0;
          byId.delete(filter._id);
          return 1;
        },
        removeFile: async (item: Row) => {
          removedFiles.push(item.filename);
        },
      }),
    };
  }

  it('marks it to go after a grace period of a few minutes, not at once', () => {
    expect(DISCARD_GRACE_MS).toBeGreaterThanOrEqual(60_000);
    expect(discardMark(NOW)).toEqual({ $set: { discardAt: later(DISCARD_GRACE_MS) } });
  });

  it('sweeps only items whose grace period is over', () => {
    expect(dueDiscards(NOW)).toEqual({ discardAt: { $lte: NOW } });
  });

  it("clears the mark on the poster's own items a post is about to take", () => {
    expect(keepForPost({ objectIds: [MINE._id], userId: ME })).toEqual({
      filter: { _id: { $in: [MINE._id] }, userId: ME, discardAt: { $exists: true } },
      update: { $unset: { discardAt: '' } },
    });
  });

  it('deletes an unused item, and its file, only with a delete conditional on its mark', async () => {
    const item = { _id: MINE._id, userId: ME, filename: 'mine.png', discardAt: NOW };
    const media = mediaRows(item);
    const deleteRow = vi.fn(media.deps().deleteRow);
    await sweepDiscardedUploads([item], NOW, { ...media.deps(), deleteRow });
    expect(deleteRow).toHaveBeenCalledWith({ _id: MINE._id, discardAt: { $lte: NOW } });
    expect(media.byId.has(MINE._id)).toBe(false);
    expect(media.removedFiles).toEqual(['mine.png']);
  });

  it('keeps an item something uses after all, clearing only the mark it read', async () => {
    const item = { _id: MINE._id, userId: ME, filename: 'mine.png', discardAt: NOW };
    const media = mediaRows(item);
    const keep = vi.fn(media.deps().keep);
    await sweepDiscardedUploads([item], NOW, { ...media.deps(new Set([MINE._id])), keep });
    expect(keep).toHaveBeenCalledWith({ _id: MINE._id, discardAt: NOW });
    expect(media.byId.get(MINE._id)?.discardAt).toBeUndefined();
    expect(media.removedFiles).toEqual([]);
  });

  it('keeps the file of an item a post claimed between the sweep reading it and deleting it', async () => {
    const item = { _id: MINE._id, userId: ME, filename: 'mine.png', discardAt: NOW };
    const media = mediaRows(item);
    const deps = media.deps();
    await sweepDiscardedUploads([item], NOW, {
      ...deps,
      // The sweep found nothing using it; then a new post took it before the delete.
      isUsed: async () => {
        media.keepForPost([MINE._id], ME);
        return false;
      },
    });
    expect(media.byId.has(MINE._id)).toBe(true);
    expect(media.removedFiles).toEqual([]);
  });

  it('refuses a post whose upload the sweep deleted before the post claimed it', async () => {
    const item = { _id: MINE._id, userId: ME, filename: 'mine.png', discardAt: NOW };
    const media = mediaRows(item);
    await sweepDiscardedUploads([item], NOW, media.deps());
    media.keepForPost([MINE._id], ME);
    expect(() =>
      cleanPostAttachments({
        attachments: [{ mediaId: MINE._id, type: 'image', url: MINE.url }],
        userId: ME,
        mediaById: new Map([...media.byId].map(([id]) => [id, MINE])),
        pulseVideoOf: () => null,
      }),
    ).toThrow(AttachmentError);
  });

  it("leaves an item marked again since it was read for a later sweep", async () => {
    const item = { _id: MINE._id, userId: ME, filename: 'mine.png', discardAt: NOW };
    const media = mediaRows({ ...item, discardAt: later(DISCARD_GRACE_MS) });
    await sweepDiscardedUploads([item], NOW, media.deps(new Set([MINE._id])));
    await sweepDiscardedUploads([item], NOW, media.deps());
    expect(media.byId.get(MINE._id)?.discardAt).toEqual(later(DISCARD_GRACE_MS));
    expect(media.removedFiles).toEqual([]);
  });

  it('keeps the file of an upload an attachment or description referenced between the sweep reading it and deleting it', async () => {
    for (const reference of [`http://localhost:3100${MINE.url}?download=1`, `Repro: ![](${MINE.url})`]) {
      const item = { _id: MINE._id, userId: ME, filename: 'mine.png', url: MINE.url, discardAt: NOW };
      const media = mediaRows(item);
      await sweepDiscardedUploads([item], NOW, {
        ...media.deps(),
        // The sweep found nothing using it; then a ticket took it before the delete.
        isUsed: async () => {
          media.keepForReference([reference]);
          return false;
        },
      });
      expect(media.byId.has(MINE._id)).toBe(true);
      expect(media.removedFiles).toEqual([]);
    }
  });
});

describe('discarding an inline image a post dropped from its text', () => {
  const NOW = new Date('2026-11-02T12:00:00Z');
  const IMAGE = { _id: 'c'.repeat(24), userId: ME, filename: 'pasted.png', url: '/uploads/media/pasted.png' };
  type Row = typeof IMAGE & { discardAt?: Date };

  /** Posts' text in memory, and the media rows; isUsed asks uploadUseQueries' text match. */
  function world(texts: string[]) {
    const rows = new Map<string, Row>([[IMAGE._id, { ...IMAGE }]]);
    const removedFiles: string[] = [];
    const isUsed = async (item: Row) => {
      const posts = uploadUseQueries({ mediaId: item._id, url: item.url }).find((q) => q.collection === 'huddlePosts')!
        .filter as { $or: Record<string, unknown>[] };
      const text = posts.$or.find((c) => 'content.text' in c)!['content.text'] as { $regex: string };
      return texts.some((t) => new RegExp(text.$regex).test(t));
    };
    const mark = async (ids: string[], update: { $set: { discardAt: Date } }) => {
      for (const id of ids) Object.assign(rows.get(id)!, update.$set);
    };
    const sweepDeps = {
      isUsed,
      keep: async () => {},
      deleteRow: async (filter: { _id: string; discardAt: { $lte: Date } }) => {
        const row = rows.get(filter._id);
        if (!row?.discardAt || row.discardAt > filter.discardAt.$lte) return 0;
        rows.delete(filter._id);
        return 1;
      },
      removeFile: async (item: Row) => {
        removedFiles.push(item.filename);
      },
    };
    return { rows, removedFiles, isUsed, mark, sweepDeps };
  }

  it('marks an image no post shows any more, and deletes nothing itself', async () => {
    const w = world(['Plan without the screenshot']);
    await markUnusedUploads([IMAGE], NOW, { isUsed: w.isUsed, mark: w.mark });
    expect(w.rows.get(IMAGE._id)?.discardAt).toEqual(new Date(NOW.getTime() + DISCARD_GRACE_MS));
    expect(w.removedFiles).toEqual([]);
  });

  it("leaves an image another post's text still shows unmarked", async () => {
    const w = world([`Wrap-up ![shot](http://localhost:3100${IMAGE.url})`]);
    await markUnusedUploads([IMAGE], NOW, { isUsed: w.isUsed, mark: w.mark });
    expect(w.rows.get(IMAGE._id)?.discardAt).toBeUndefined();
  });

  it('keeps the file of an image a post showed between the sweep reading it and deleting it', async () => {
    const w = world([]);
    await markUnusedUploads([IMAGE], NOW, { isUsed: w.isUsed, mark: w.mark });
    const due = new Date(NOW.getTime() + DISCARD_GRACE_MS);
    const item = { ...w.rows.get(IMAGE._id)! };
    await sweepDiscardedUploads([item], due, {
      ...w.sweepDeps,
      // The sweep found nothing showing it; then a post's text took it before the delete.
      isUsed: async () => {
        const kept = keepForReference([`Again ![shot](${IMAGE.url})`])!;
        for (const row of w.rows.values()) if (kept.filter.url.$in.includes(row.url)) delete row.discardAt;
        return false;
      },
    });
    expect(w.rows.has(IMAGE._id)).toBe(true);
    expect(w.removedFiles).toEqual([]);
  });

  it('deletes it, file and all, once its grace period is over and nothing shows it', async () => {
    const w = world([]);
    await markUnusedUploads([IMAGE], NOW, { isUsed: w.isUsed, mark: w.mark });
    const item = { ...w.rows.get(IMAGE._id)! };
    await sweepDiscardedUploads([item], NOW, w.sweepDeps);
    expect(w.rows.has(IMAGE._id)).toBe(true);
    await sweepDiscardedUploads([item], new Date(NOW.getTime() + DISCARD_GRACE_MS), w.sweepDeps);
    expect(w.rows.has(IMAGE._id)).toBe(false);
    expect(w.removedFiles).toEqual(['pasted.png']);
  });
});

describe('keepForReference', () => {
  const kept = (urls: string[]) => ({
    filter: { url: { $in: urls }, discardAt: { $exists: true } },
    update: { $unset: { discardAt: '' } },
  });

  it("clears the mark on the upload at an attachment's URL, full or not, with a query or fragment", () => {
    expect(keepForReference([`http://localhost:3100${MINE.url}?download=1`])).toEqual(kept([MINE.url]));
    expect(keepForReference([`${MINE.url}#page=2`])).toEqual(kept([MINE.url]));
  });

  it("clears the mark on every upload a ticket description links or embeds, anyone's", () => {
    const description = `Repro ![](${MINE.url}) and [doc](http://localhost:3100${THEIRS.url}#page=2), again ${MINE.url}`;
    expect(keepForReference([description])).toEqual(kept([MINE.url, THEIRS.url]));
  });

  it('is null when nothing referenced is an upload', () => {
    expect(keepForReference(['https://example.com/spec', '/pulsevault/artifacts/abc', undefined, ''])).toBeNull();
  });
});
