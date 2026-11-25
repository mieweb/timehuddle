/**
 * Activity log — port of emitActivity from backend/src/services/activity.service.ts.
 *
 * Appends to the shared `activities` collection. Best-effort: failures are
 * swallowed so the activity feed never blocks a clock write.
 */
import { MongoInternals } from 'meteor/mongo';
import { rawDb } from './collections';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

export const ActivityType = {
  ClockIn: 'clock.in',
  ClockOut: 'clock.out',
  OrgMemberBlocked: 'org.member-blocked',
  OrgMemberUnblocked: 'org.member-unblocked',
};

const DUPLICATE_KEY = 11000;

/**
 * Insert an activity event. Mirror of activityService.emitActivity. An insert
 * a unique index rejects was already recorded, so it is not an error.
 */
export async function emitActivity(input) {
  try {
    const doc = {
      _id: new ObjectId(),
      occurredAt: new Date(),
      source: 'timehuddle',
      ...input,
    };
    await rawDb().collection('activities').insertOne(doc);
  } catch (err) {
    if (err?.code === DUPLICATE_KEY) return;
    console.error('[activity] emitActivity failed:', err);
  }
}

/**
 * Record a session's clock-out in the feed, once per `clockEventId` (a clock-out
 * left half done is finished again): the unique index in activity.js turns a
 * second insert into a no-op. `auto` marks one made by the 8-hour job.
 */
export async function emitClockOutActivity({
  userId,
  userName,
  teamId,
  teamName,
  clockEventId,
  durationSeconds,
  auto,
}) {
  await emitActivity({
    userId,
    teamId,
    type: ActivityType.ClockOut,
    actor: { id: userId, name: userName },
    payload: { teamId, teamName, clockEventId, durationSeconds, ...(auto && { auto: true }) },
  });
}
