import { getDB } from "./db.js";

export async function ensureIndexes() {
  const db = getDB();

  const profiles = db.collection("profiles");
  await profiles.createIndex({ userId: 1, app: 1 }, { unique: true });

  // Encrypted op-log relay (E2E encrypted sync)
  const encryptedOpLogs = db.collection("encryptedOpLogs");
  await encryptedOpLogs.createIndex({ userId: 1, hlc: 1 });
  await encryptedOpLogs.createIndex({ userId: 1, deviceId: 1, hlc: 1 });

  // ── TimeEntry indexes ──────────────────────────────────────────────────────
  const timeEntries = db.collection("timeentries");
  // 1. Lookup index for user × ticket × day (duplicates are allowed)
  const timeEntryIndexes = await timeEntries.indexes();
  const legacyNaturalKey = timeEntryIndexes.find(
    (idx) =>
      idx.unique === true && idx.key?.userId === 1 && idx.key?.ticketId === 1 && idx.key?.date === 1
  );
  if (legacyNaturalKey?.name) {
    await timeEntries.dropIndex(legacyNaturalKey.name);
  }
  await timeEntries.createIndex({ userId: 1, ticketId: 1, date: 1 });
  // 2. Day view — all entries for a user on a given UTC date
  await timeEntries.createIndex({ userId: 1, date: 1 });

  // ── TimerSession indexes ───────────────────────────────────────────────────
  const timerSessions = db.collection("timersessions");
  // 3. At most one running session per user (unique partial index)
  await timerSessions.createIndex(
    { userId: 1 },
    { unique: true, partialFilterExpression: { endTime: null }, name: "one_running_per_user" }
  );
  // 4. Sessions within a TimeEntry, ordered by start time
  await timerSessions.createIndex({ timeEntryId: 1, startTime: 1 });
  // 5. Sessions for a user on a given UTC date
  await timerSessions.createIndex({ userId: 1, date: 1 });

  console.log("MongoDB indexes ensured");
}
