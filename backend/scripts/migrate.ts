/**
 * Migration runner.
 *
 * Usage:
 *   npm run migrate                  # apply all pending migrations
 *   MONGODB_URI=... npm run migrate  # explicit URI
 *
 * Each migration file in scripts/migrations/ must export:
 *   name: string          — unique identifier (used as the idempotency key)
 *   up(db: Db): Promise<void>  — forward migration
 *
 * Applied migrations are recorded in the `_migrations` collection so the
 * runner skips them on subsequent runs. Safe to run repeatedly.
 */

import { MongoClient } from "mongodb";
import * as m001 from "./migrations/001-normalize-clock-event-times.js";
import * as m002 from "./migrations/002-remove-legacy-timer-fields.js";

// ─── Register migrations in order ────────────────────────────────────────────
// Add new entries here — order matters, earlier entries run first.
const migrations = [m001, m002];

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const coll = db.collection("_migrations");

  console.log("Connected to MongoDB");

  try {
    const applied = new Set((await coll.find().toArray()).map((m) => m.name));

    let ran = 0;
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        console.log(`  skip  ${migration.name}`);
        continue;
      }

      console.log(`  apply ${migration.name} ...`);
      await migration.up(db);
      await coll.insertOne({ name: migration.name, appliedAt: new Date() });
      console.log(`  done  ${migration.name}`);
      ran++;
    }

    console.log(`\n${ran} migration(s) applied.`);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
