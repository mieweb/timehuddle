/**
 * A video's name: one per video, on its media item (`mediaitems.title`, found
 * by `videoid`) — the Pulse draft's name, an uploaded file's name, or what its
 * owner renamed it to. Everything that shows a video (a ticket's or a clock
 * session's Videos, a timesheet walkthrough, a Huddle post's card) looks it up
 * here at read time instead of keeping its own copy, so a rename shows
 * everywhere at once. A Huddle post's own text stays what was posted.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge.js';
import { rawDb } from './collections.js';
import { artifactBelongsTo } from './pulsevault.js';
import { cleanVideoName, videoIdOf, videoNameOf } from './video-names-core.js';

export { cleanVideoName, videoIdOf, videoNameOf, VIDEO_NAME_MAX } from './video-names-core.js';

/** A duplicate key: another write made this video's media item first. */
export const isDuplicateKey = (err) => err?.code === 11000;

// One media item per video. Fails (and says so) where duplicates already
// exist; reads still work then, the newest match winning.
Meteor.startup(async () => {
  try {
    await rawDb()
      .collection('mediaitems')
      .createIndex(
        { videoid: 1 },
        { unique: true, partialFilterExpression: { videoid: { $type: 'string' } } },
      );
  } catch (error) {
    console.error('[video-names] no unique mediaitems.videoid index (duplicates?):', error.message);
  }
});

/** Each video's name, media item and owner, by video id (absent: no media item). */
export async function videoNamesFor(videoIds) {
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const items = await rawDb()
    .collection('mediaitems')
    .find({ videoid: { $in: ids } }, { projection: { videoid: 1, title: 1, userId: 1 } })
    .toArray();
  return new Map(
    items.map((m) => [m.videoid, { mediaId: m._id.toHexString(), name: videoNameOf(m.title), ownerId: m.userId }]),
  );
}

Meteor.methods({
  /**
   * Name one of your own videos (empty clears it). The name is on its media
   * item, so it shows everywhere the video appears. A video from before every
   * video had a media item gets one on its first name, if PulseVault's own
   * record says you uploaded it — never because you attached it somewhere
   * (attachments.add takes any URL). That item is `embedded`: naming a video
   * doesn't put it in your media library for teammates to browse.
   */
  async 'videos.rename'({ videoId, name } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const id = videoIdOf(`/pulsevault/artifacts/${videoId}`);
    if (!id) throw new Meteor.Error('not-found', 'Video not found');
    const media = rawDb().collection('mediaitems');
    const title = cleanVideoName(name);
    const item = await media.findOne({ videoid: id }, { projection: { userId: 1 } });
    if (item) {
      if (item.userId !== userId) throw new Meteor.Error('forbidden', 'Not your video');
      await media.updateOne({ _id: item._id }, { $set: { title } });
      return { name: videoNameOf(title) };
    }
    if (!(await artifactBelongsTo(id, userId))) throw new Meteor.Error('forbidden', 'Not your video');
    try {
      await media.updateOne(
        { videoid: id },
        {
          $set: { title },
          $setOnInsert: {
            userId,
            type: 'video',
            mimeType: 'video/mp4',
            url: `/pulsevault/artifacts/${id}`,
            videoid: id,
            filename: `${id}.mp4`,
            size: 0,
            caption: null,
            altText: null,
            thumbnail: null,
            embedded: true,
            uploadedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (err) {
      // Two first names at once: the unique index let one insert; name that one.
      if (!isDuplicateKey(err)) throw err;
      await media.updateOne({ videoid: id, userId }, { $set: { title } });
    }
    return { name: videoNameOf(title) };
  },
});

/** `requests` with each one's walkthrough name (`videoName`), looked up in one query. */
export async function withVideoNames(requests) {
  const names = await videoNamesFor(requests.map((r) => videoIdOf(r?.videoUrl)));
  return requests.map((r) => ({ ...r, videoName: names.get(videoIdOf(r?.videoUrl))?.name ?? null }));
}
