import type { Db } from "mongodb";

export const name = "002-activity-log-index";

/**
 * Creates a compound index on the activities collection to support
 * efficient cursor-paginated queries by user, newest-first.
 *
 * Index: { userId: 1, occurredAt: -1 }
 */
export async function up(db: Db): Promise<void> {
  const coll = db.collection("activities");
  await coll.createIndex({ userId: 1, occurredAt: -1 }, { background: true });
}
