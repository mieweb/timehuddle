import type { Db } from "mongodb";

export const name = "001-normalize-clock-event-times";

/**
 * Backfills existing clockEvent documents to the normalized schema:
 *   - startTimestamp (number) → startTime (number)  [already epoch ms, just rename]
 *   - endTime (Date | ISOString) → endTime (number | null)  [convert to epoch ms]
 *
 * Safe to run multiple times — the $exists guards prevent double-processing.
 */
export async function up(db: Db): Promise<void> {
  const coll = db.collection("clockEvent");

  // 1. Rename startTimestamp → startTime for docs that haven't been migrated yet.
  await coll.updateMany({ startTimestamp: { $exists: true }, startTime: { $exists: false } }, [
    { $set: { startTime: "$startTimestamp" } },
    { $unset: "startTimestamp" },
  ]);

  // 2. Convert endTime from Date/string to epoch ms number.
  //    Docs where endTime is already null or a number are already correct.
  const cursor = coll.find({ endTime: { $type: "date" } });
  let count = 0;
  for await (const doc of cursor) {
    const ms = (doc.endTime as Date).getTime();
    await coll.updateOne({ _id: doc._id }, { $set: { endTime: ms } });
    count++;
  }
  if (count > 0) console.log(`  Converted ${count} endTime Date → number`);
}
