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

/** Insert an activity event. Mirror of activityService.emitActivity. */
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
    console.error('[activity] emitActivity failed:', err);
  }
}
