/**
 * Migration: Backfill break type classification on existing clock event break entries.
 *
 * Breaks without a `type` field are auto-classified based on duration:
 *   - duration < 1800 seconds (30 min) → type: "rest"   (compensable, not deducted)
 *   - duration >= 1800 seconds (30 min) → type: "meal"  (non-compensable, deducted)
 *
 * Open breaks (endTime === null) are skipped — they will be classified when they close.
 */

const MEAL_BREAK_THRESHOLD_SECONDS = 30 * 60;

/** @param {import("mongodb").Db} db */
async function up(db) {
  const coll = db.collection("clockevents");

  // Process in batches to avoid loading all documents at once.
  const cursor = coll.find({ breaks: { $elemMatch: { endTime: { $ne: null }, type: { $exists: false } } } });

  let modified = 0;
  for await (const doc of cursor) {
    if (!Array.isArray(doc.breaks)) continue;

    const updatedBreaks = doc.breaks.map((b) => {
      if (typeof b.endTime !== "number") return b; // open break — skip
      if (b.type !== undefined) return b;           // already classified — skip

      const durationSeconds = Math.max(0, Math.floor((b.endTime - b.startTime) / 1000));
      const type = durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? "meal" : "rest";
      return { ...b, type, classificationSource: "auto" };
    });

    await coll.updateOne(
      { _id: doc._id },
      { $set: { breaks: updatedBreaks } }
    );
    modified++;
  }

  console.log(`[backfill-break-type] updated ${modified} clock event document(s)`);
}

/** @param {import("mongodb").Db} db */
async function down(db) {
  // Remove auto-classified type fields from break entries.
  const result = await db.collection("clockevents").updateMany(
    { "breaks.classificationSource": "auto" },
    {
      $unset: {
        "breaks.$[elem].type": "",
        "breaks.$[elem].classificationSource": "",
      },
    },
    {
      arrayFilters: [{ "elem.classificationSource": "auto" }],
    }
  );
  console.log(`[backfill-break-type] rolled back ${result.modifiedCount} document(s)`);
}

module.exports = { up, down };
