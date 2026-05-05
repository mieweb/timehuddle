import type { Db } from "mongodb";

export const name = "002-remove-legacy-timer-fields";

export async function up(db: Db): Promise<void> {
  // Remove accumulatedTime and startTimestamp from all ticket documents
  await db
    .collection("tickets")
    .updateMany(
      { $or: [{ accumulatedTime: { $exists: true } }, { startTimestamp: { $exists: true } }] },
      { $unset: { accumulatedTime: "", startTimestamp: "" } }
    );

  // Remove tickets[] from all clock event documents
  await db
    .collection("clockevents")
    .updateMany({ tickets: { $exists: true } }, { $unset: { tickets: "" } });
}
