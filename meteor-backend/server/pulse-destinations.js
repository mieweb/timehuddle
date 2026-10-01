/**
 * Pulse destinations — where a Pulse upload ends up, decided when it's
 * reserved and carried out by the server the moment it lands.
 *
 * Pulse is built as "one link, one upload": each pairing link names one video
 * id and one place it goes. The web app never has to collect the finished
 * video and do something with it — the upload *is* the post, the attachment,
 * the walkthrough. Every place that offers Pulse picks one of these:
 *
 *   huddle             → a new Huddle post in that team
 *   clock-plan         → a new plan post, then clock in to that team
 *   clock-wrapup       → the session's post gets the video as its wrap-up,
 *                        then clock out
 *   ticket | clock     → an attachment on that ticket / clock session
 *   timesheet-request  → the walkthrough on the caller's pending change request
 *   library            → the caller's media library (API clients)
 *
 * `resolvePulseDestination` validates a destination at reserve time (so a bad
 * one fails before anyone records anything); `deliverPulseVideo` carries it
 * out from PulseVault's onUploadComplete.
 *
 * A video is never thrown away. If its destination stopped being valid while
 * it was recorded (the session was deleted, the change was reviewed, the
 * uploader left the team), it's kept in the uploader's media library with the
 * destination it was recorded for, and the reason goes back to the Pulse
 * popup.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { createAttachment } from './attachments.js';
import { isValidId, rawDb } from './collections.js';
import { createHuddlePost, SESSION_POST_SORT } from './huddle.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const POST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// clock.js reaches pulsevault.js through timesheet-change-requests.js, so a
// static import here would close a cycle; load it when a clock upload lands.
const clockModule = () => import('./clock.js');

function badRequest(message) {
  return new Meteor.Error('bad-request', message);
}

async function assertTeamMember(userId, teamId) {
  if (!isValidId(teamId)) throw badRequest('Invalid teamId');
  const team = await rawDb()
    .collection('teams')
    .findOne({ _id: new ObjectId(teamId) }, { projection: { members: 1, admins: 1 } });
  const isMember = [...(team?.members ?? []), ...(team?.admins ?? [])].includes(userId);
  if (!isMember) throw new Meteor.Error('forbidden', 'Not a member of this team');
}

async function ownSession(userId, clockEventId) {
  if (!isValidId(clockEventId)) throw badRequest('Invalid clockEventId');
  const session = await rawDb()
    .collection('clockevents')
    .findOne({ _id: new ObjectId(clockEventId) }, { projection: { userId: 1, teamId: 1, endTime: 1 } });
  if (!session) throw new Meteor.Error('not-found', 'Clock session not found');
  if (session.userId !== userId) throw new Meteor.Error('forbidden', 'Not your clock session');
  return session;
}

/**
 * Check `destination` is somewhere `userId` may send a Pulse video, and return
 * the normalized form stored on the reservation. Throws a Meteor.Error if not.
 */
export async function resolvePulseDestination(userId, destination = {}) {
  const { kind } = destination;
  switch (kind) {
    case 'huddle':
      await assertTeamMember(userId, destination.teamId);
      return { kind, teamId: destination.teamId };

    case 'clock-plan': {
      await assertTeamMember(userId, destination.teamId);
      // The poster's calendar date, from their device — the server can't know
      // their time zone, and the plan-first gate is per date.
      if (!POST_DATE_RE.test(destination.postDate ?? '')) throw badRequest('Invalid postDate');
      return { kind, teamId: destination.teamId, postDate: destination.postDate };
    }

    case 'clock-wrapup': {
      const session = await ownSession(userId, destination.clockEventId);
      if (session.endTime != null) throw badRequest('That clock session has already ended');
      if (!POST_DATE_RE.test(destination.postDate ?? '')) throw badRequest('Invalid postDate');
      return { kind, clockEventId: destination.clockEventId, postDate: destination.postDate };
    }

    case 'ticket': {
      if (!isValidId(destination.id)) throw badRequest('Invalid ticket id');
      const ticket = await rawDb()
        .collection('tickets')
        .findOne({ _id: new ObjectId(destination.id) }, { projection: { _id: 1 } });
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      return { kind, id: destination.id };
    }

    case 'clock':
      await ownSession(userId, destination.id);
      return { kind, id: destination.id };

    case 'timesheet-request': {
      if (!isValidId(destination.id)) throw badRequest('Invalid request id');
      const request = await rawDb()
        .collection('timesheetchangerequests')
        .findOne({ _id: new ObjectId(destination.id) }, { projection: { userId: 1, status: 1 } });
      if (!request) throw new Meteor.Error('not-found', 'Change request not found');
      if (request.userId !== userId) throw new Meteor.Error('forbidden', 'Not your change request');
      if (request.status !== 'pending') throw badRequest('That change has already been reviewed');
      return { kind, id: destination.id };
    }

    case 'library':
      return { kind };

    default:
      throw badRequest('Unknown Pulse destination');
  }
}

/**
 * Record the upload in the uploader's media library; returns its id. One item
 * per video, so keeping a video after a half-finished delivery can't add a
 * second. `recordedFor` is the destination a kept video never reached.
 */
async function addToLibrary(userId, video, recordedFor = null) {
  const items = rawDb().collection('mediaitems');
  await items.updateOne(
    { userId, videoid: video.artifactId },
    {
      $setOnInsert: {
        type: 'video',
        mimeType: video.mimeType,
        url: video.url,
        filename: video.filename,
        size: video.size,
        title: video.title,
        caption: null,
        altText: null,
        thumbnail: video.thumbnail,
        uploadedAt: new Date(),
      },
      ...(recordedFor ? { $set: { recordedFor } } : {}),
    },
    { upsert: true },
  );
  const { _id } = await items.findOne({ userId, videoid: video.artifactId }, { projection: { _id: 1 } });
  return _id.toHexString();
}

/** The attachment shape a Huddle post stores for a Pulse video. */
function postAttachment(mediaId, video) {
  return { mediaId, type: 'video', url: video.url, filename: video.title };
}

/**
 * Carry out a reservation's destination for a finished Pulse video, keeping
 * it in the uploader's library if that's no longer possible.
 *
 * `video` is `{ artifactId, url, name, title, filename, mimeType, size,
 * thumbnail }`: `name` is the Pulse draft's title (Upload-Metadata `name`) or
 * null, `title` the display title (the name, or a short fallback).
 *
 * Returns `{ kept: false }` once delivered, or `{ kept: true, reason }` when
 * the video went to the library instead.
 */
export async function deliverPulseVideo(userId, destination, video) {
  try {
    await deliverTo(userId, destination, video);
    return { kept: false };
  } catch (err) {
    if (destination.kind === 'library') throw err;
    console.warn('[pulse-destinations] kept in library, not delivered to', destination.kind, err);
    await addToLibrary(userId, video, destination);
    const reason = err instanceof Meteor.Error ? err.reason : 'Something went wrong adding it there.';
    return { kept: true, reason };
  }
}

async function deliverTo(userId, destination, video) {
  const db = rawDb();
  switch (destination.kind) {
    case 'huddle': {
      const mediaId = await addToLibrary(userId, video);
      await createHuddlePost(userId, {
        teamId: destination.teamId,
        content: { text: video.name ?? '', mentions: [] },
        attachments: [postAttachment(mediaId, video)],
      });
      return;
    }

    case 'clock-plan': {
      const mediaId = await addToLibrary(userId, video);
      const { id: planPostId } = await createHuddlePost(userId, {
        teamId: destination.teamId,
        content: { text: video.name ?? '', mentions: [] },
        attachments: [postAttachment(mediaId, video)],
        postDate: destination.postDate,
      });
      const { clockStart } = await clockModule();
      const open = await db
        .collection('clockevents')
        .findOne({ userId, teamId: destination.teamId, endTime: null }, { projection: { _id: 1 } });
      // Clocked in some other way meanwhile: the plan still posts, no second session.
      if (!open) await clockStart(userId, { teamId: destination.teamId, planPostId });
      return;
    }

    case 'clock-wrapup': {
      const session = await db
        .collection('clockevents')
        .findOne({ _id: new ObjectId(destination.clockEventId), userId });
      if (!session) throw new Meteor.Error('not-found', 'That clock session no longer exists.');
      const mediaId = await addToLibrary(userId, video);
      const attachment = postAttachment(mediaId, video);
      const wrapUpLine = video.name ? `**Wrap-up:** ${video.name}` : '**Wrap-up**';
      const sessionPost = await db
        .collection('huddlePosts')
        .findOne(
          { teamId: session.teamId, userId, clockEventId: destination.clockEventId, status: { $ne: 'draft' } },
          { sort: SESSION_POST_SORT },
        );
      if (sessionPost) {
        const planText = sessionPost.content?.text ?? '';
        await db.collection('huddlePosts').updateOne(
          { _id: sessionPost._id },
          {
            $push: { attachments: attachment },
            $set: {
              'content.text': planText ? `${planText}\n\n${wrapUpLine}` : wrapUpLine,
              wrapUpAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );
      } else {
        await createHuddlePost(userId, {
          teamId: session.teamId,
          content: { text: wrapUpLine, mentions: [] },
          attachments: [attachment],
          postDate: destination.postDate,
          clockEventId: destination.clockEventId,
          wrapUp: true,
        });
      }
      // Already clocked out some other way: the wrap-up still lands on the post.
      if (session.endTime == null) {
        const { clockStop } = await clockModule();
        await clockStop(userId, { teamId: session.teamId });
      }
      return;
    }

    case 'ticket':
    case 'clock':
      await createAttachment({
        url: video.url,
        type: 'video',
        title: video.title,
        ...(video.thumbnail ? { thumbnail: video.thumbnail } : {}),
        attachedTo: { kind: destination.kind, id: destination.id },
        addedBy: userId,
      });
      return;

    case 'timesheet-request': {
      // Only while still pending: a walkthrough can't change a decided request.
      const { matchedCount } = await db
        .collection('timesheetchangerequests')
        .updateOne(
          { _id: new ObjectId(destination.id), userId, status: 'pending' },
          { $set: { videoUrl: video.url } },
        );
      if (!matchedCount) throw new Meteor.Error('bad-request', 'That change has already been reviewed.');
      return;
    }

    case 'library':
      await addToLibrary(userId, video);
      return;

    default:
      throw new Meteor.Error('bad-request', 'Unknown Pulse destination.');
  }
}
