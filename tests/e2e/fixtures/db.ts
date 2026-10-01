/**
 * Direct Mongo access for E2E tests: reading back what the server stored, and
 * the out-of-band changes a test needs (a session deleted, a member removed)
 * that the UI has no button for.
 */
import { MongoClient, ObjectId, type Db } from 'mongodb';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    return await fn(client.db());
  } finally {
    await client.close();
  }
}

/** The seed user's `_id`. */
export async function getUserIdByEmail(email: string): Promise<string> {
  const user = await withDb((db) =>
    db.collection('users').findOne({ 'emails.address': email }, { projection: { _id: 1 } }),
  );
  if (!user) throw new Error(`Seed user ${email} not found — did global-setup run?`);
  return String(user._id);
}

/** The `_id` of the team called `name`. */
export async function findTeamIdByName(name: string): Promise<string> {
  const team = await withDb((db) =>
    db.collection('teams').findOne({ name }, { projection: { _id: 1 } }),
  );
  if (!team) throw new Error(`Team ${name} not found`);
  return String(team._id);
}

/** The user's open clock session in `teamId`, if they're clocked in there. */
export async function findOpenClockEventId(email: string, teamId: string): Promise<string | null> {
  const userId = await getUserIdByEmail(email);
  return withDb(async (db) => {
    const event = await db
      .collection('clockevents')
      .findOne({ userId, teamId, endTime: null }, { projection: { _id: 1 } });
    return event ? String(event._id) : null;
  });
}

/** Delete a clock session outright (as an admin cleaning up timesheets might). */
export async function deleteClockEvent(clockEventId: string): Promise<void> {
  await withDb((db) => db.collection('clockevents').deleteOne({ _id: new ObjectId(clockEventId) }));
}

/** Take `email`'s user off a team, as a member and as an admin. */
export async function removeFromTeam(teamId: string, email: string): Promise<void> {
  const userId = await getUserIdByEmail(email);
  await withDb((db) =>
    db
      .collection<{ _id: ObjectId; members: string[]; admins: string[] }>('teams')
      .updateOne({ _id: new ObjectId(teamId) }, { $pull: { members: userId, admins: userId } }),
  );
}

/** Mark a ticket deleted, as the ticket list's Delete does. */
export async function markTicketDeleted(ticketId: string): Promise<void> {
  await withDb((db) =>
    db
      .collection('tickets')
      .updateOne({ _id: new ObjectId(ticketId) }, { $set: { status: 'deleted' } }),
  );
}

/** The media library item for a Pulse video, if there is one. */
export async function findLibraryVideo(
  videoid: string,
): Promise<{ _id: ObjectId; recordedFor?: Record<string, string> } | null> {
  return withDb((db) =>
    db.collection<{ _id: ObjectId; recordedFor?: Record<string, string> }>('mediaitems').findOne({
      videoid,
    }),
  );
}

/** The Huddle post a Pulse video was delivered to, if there is one. */
export async function findPostWithVideo(
  videoid: string,
): Promise<{ clockEventId?: string } | null> {
  return withDb((db) =>
    db
      .collection<{ clockEventId?: string }>('huddlePosts')
      .findOne({ 'attachments.url': `/pulsevault/artifacts/${videoid}` }),
  );
}
