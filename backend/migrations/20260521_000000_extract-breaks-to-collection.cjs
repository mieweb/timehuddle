/**
 * Migration: Extract embedded breaks from clockevents → clockbreaks collection
 *
 * Up:   For each clock event that has a non-empty `breaks` array, insert each break
 *       as its own document in the `clockbreaks` collection (clockEventId = parent _id).
 *       Then $unset `breaks` from all clockevents docs.
 *
 * Down: Rebuild embedded `breaks` arrays from `clockbreaks`, write them back, delete
 *       all clockbreaks documents.
 *
 * NOTE: The break-type classification threshold was 30 min in the previous backfill
 *       migration (20260518_090000) but is now 20 min. Historical breaks that were
 *       classified using the 30-min rule retain their stored `type`; this migration
 *       does not reclassify them.
 */

/** @type {import('migrate-mongo').MigrationFile} */
module.exports = {
  async up(db) {
    const clockEventsCollection = db.collection("clockevents");
    const clockBreaksCollection = db.collection("clockbreaks");

    const { ObjectId } = require("mongodb");

    // Iterate over all events that still have an embedded breaks array
    const cursor = clockEventsCollection.find({ "breaks.0": { $exists: true } });

    let inserted = 0;
    while (await cursor.hasNext()) {
      const event = await cursor.next();
      if (!event || !Array.isArray(event.breaks) || event.breaks.length === 0) continue;

      const clockEventId = event._id.toHexString();
      const docs = event.breaks
        .filter((b) => b && typeof b.startTime === "number")
        .map((b) => ({
          _id: new ObjectId(),
          clockEventId,
          startTime: b.startTime,
          endTime: typeof b.endTime === "number" ? b.endTime : null,
          ...(b.type !== undefined && { type: b.type }),
          ...(b.classificationSource !== undefined && {
            classificationSource: b.classificationSource,
          }),
          ...(b.notes !== undefined && { notes: b.notes }),
          ...(b.updatedBy !== undefined && { updatedBy: b.updatedBy }),
          ...(b.updatedAt !== undefined && { updatedAt: b.updatedAt }),
        }));

      if (docs.length > 0) {
        await clockBreaksCollection.insertMany(docs, { ordered: false });
        inserted += docs.length;
      }
    }

    // Remove the embedded breaks field from all clock event documents
    await clockEventsCollection.updateMany(
      { breaks: { $exists: true } },
      { $unset: { breaks: "" } }
    );

    console.log(`[migration up] Extracted ${inserted} break(s) into clockbreaks collection.`);
  },

  async down(db) {
    const clockEventsCollection = db.collection("clockevents");
    const clockBreaksCollection = db.collection("clockbreaks");

    // Load all breaks and group by clockEventId
    const allBreaks = await clockBreaksCollection.find({}).toArray();
    const breaksByEventId = new Map();
    for (const b of allBreaks) {
      const arr = breaksByEventId.get(b.clockEventId) ?? [];
      arr.push({
        startTime: b.startTime,
        endTime: b.endTime,
        ...(b.type !== undefined && { type: b.type }),
        ...(b.classificationSource !== undefined && {
          classificationSource: b.classificationSource,
        }),
        ...(b.notes !== undefined && { notes: b.notes }),
        ...(b.updatedBy !== undefined && { updatedBy: b.updatedBy }),
        ...(b.updatedAt !== undefined && { updatedAt: b.updatedAt }),
      });
      breaksByEventId.set(b.clockEventId, arr);
    }

    // Write embedded arrays back to each event
    let restored = 0;
    for (const [clockEventId, breaks] of breaksByEventId.entries()) {
      const { ObjectId } = require("mongodb");
      await clockEventsCollection.updateOne(
        { _id: new ObjectId(clockEventId) },
        { $set: { breaks } }
      );
      restored += breaks.length;
    }

    // Remove all documents from clockbreaks
    await clockBreaksCollection.deleteMany({});

    console.log(`[migration down] Restored ${restored} break(s) into clockevents documents.`);
  },
};
