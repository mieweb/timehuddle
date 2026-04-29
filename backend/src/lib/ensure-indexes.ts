import { getDB } from "./db.js";

export async function ensureIndexes() {
  const db = getDB();

  const profiles = db.collection("profiles");
  await profiles.createIndex({ userId: 1, app: 1 }, { unique: true });

  // Encrypted op-log relay (E2E encrypted sync)
  const encryptedOpLogs = db.collection("encryptedOpLogs");
  await encryptedOpLogs.createIndex({ userId: 1, hlc: 1 });
  await encryptedOpLogs.createIndex({ userId: 1, deviceId: 1, hlc: 1 });

  console.log("MongoDB indexes ensured");
}
