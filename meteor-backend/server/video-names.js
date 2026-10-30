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
import { artifactBelongsTo, videoArtifactExists, videoArtifactStatus } from './pulsevault.js';
import {
  CANONICAL_ITEM,
  cleanVideoName,
  mayRenameVideo,
  publicVideoInfo,
  videoIdOf as videoIdOfUrl,
  videoNameOf,
} from './video-names-core.js';

export {
  CANONICAL_ITEM,
  cleanVideoName,
  mayRenameVideo,
  videoNameOf,
  VIDEO_NAME_MAX,
} from './video-names-core.js';

/** This backend's own origin: the one a full video URL may be on. */
const OWN_ORIGINS = [new URL(Meteor.absoluteUrl()).origin];

/** The video id in a video URL: a path, or a full URL on this backend; else null. */
export const videoIdOf = (url) => videoIdOfUrl(url, OWN_ORIGINS);

/** A duplicate key: another write made this video's media item first. */
export const isDuplicateKey = (err) => err?.code === 11000;

// One media item per video. Fails (and says so) where duplicates already
// exist; reads and writes still agree then, on CANONICAL_ITEM.
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
    .find({ videoid: { $in: ids } }, { projection: { videoid: 1, title: 1, userId: 1 }, ...CANONICAL_ITEM })
    .toArray();
  const names = new Map();
  for (const m of items) {
    // The first is CANONICAL_ITEM's, where old data has duplicates.
    if (names.has(m.videoid)) continue;
    names.set(m.videoid, { mediaId: m._id.toHexString(), name: videoNameOf(m.title, m.videoid), ownerId: m.userId });
  }
  return names;
}

/** The signed-in caller, or null for someone who isn't (a shared link's reader). */
async function viewerOf(methodContext) {
  try {
    return await requireIdentity(methodContext);
  } catch {
    return null;
  }
}

Meteor.methods({
  /**
   * What a video's watch page (`/watch/:videoId`) shows, to anyone with its
   * link — playback itself is public. Its name and when it was added; who
   * added it only to someone signed in, since a shared link can travel
   * outside the team. Not found when PulseVault has no such video.
   */
  async 'videos.publicInfo'({ videoId } = {}) {
    const id = videoIdOf(`/pulsevault/artifacts/${videoId}`);
    if (!id) throw new Meteor.Error('not-found', 'Video not found');
    const item = await rawDb()
      .collection('mediaitems')
      .findOne({ videoid: id }, { projection: { title: 1, userId: 1, uploadedAt: 1 }, ...CANONICAL_ITEM });
    if (!item && !(await videoArtifactExists(id))) {
      throw new Meteor.Error('not-found', 'Video not found');
    }
    const viewer = await viewerOf(this);
    const owner =
      viewer && item
        ? await rawDb()
            .collection('users')
            .findOne({ _id: item.userId }, { projection: { 'profile.name': 1, image: 1 } })
        : null;
    const canRename = mayRenameVideo({
      item,
      userId: viewer?.userId,
      uploadedByUser: viewer && !item ? await artifactBelongsTo(id, viewer.userId) : false,
    });
    return publicVideoInfo({ id, item, viewerId: viewer?.userId, owner, canRename });
  },

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
    const item = await media.findOne({ videoid: id }, { projection: { userId: 1 }, ...CANONICAL_ITEM });
    const uploadedByUser = item ? false : await artifactBelongsTo(id, userId);
    if (!mayRenameVideo({ item, userId, uploadedByUser })) {
      throw new Meteor.Error('forbidden', 'Not your video');
    }
    if (item) {
      await media.updateOne({ _id: item._id }, { $set: { title } });
      return { name: videoNameOf(title, id) };
    }
    // Only what's known about it: PulseVault keeps its size, not its type,
    // file name or upload time, so those stay empty rather than made up.
    const status = await videoArtifactStatus(id);
    try {
      await media.updateOne(
        { videoid: id },
        {
          $set: { title },
          $setOnInsert: {
            userId,
            type: 'video',
            mimeType: null,
            url: `/pulsevault/artifacts/${id}`,
            videoid: id,
            filename: null,
            size: status?.bytesReceived ?? status?.size ?? null,
            caption: null,
            altText: null,
            thumbnail: null,
            embedded: true,
            uploadedAt: null,
          },
        },
        { upsert: true },
      );
    } catch (err) {
      // Two first names at once: the unique index let one insert; name that one.
      if (!isDuplicateKey(err)) throw err;
      await media.updateOne({ videoid: id, userId }, { $set: { title } });
    }
    return { name: videoNameOf(title, id) };
  },
});

/** `requests` with each one's walkthrough name (`videoName`), looked up in one query. */
export async function withVideoNames(requests) {
  const names = await videoNamesFor(requests.map((r) => videoIdOf(r?.videoUrl)));
  return requests.map((r) => ({ ...r, videoName: names.get(videoIdOf(r?.videoUrl))?.name ?? null }));
}
