import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ObjectId } from "mongodb";
import { connectDB, getDB } from "../src/lib/db.js";
import { up } from "../scripts/migrations/001-normalize-clock-event-times.js";

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await getDB()
    .collection("_migration_test_clock")
    .drop()
    .catch(() => {});
});

describe("001-normalize-clock-event-times", () => {
  it("renames startTimestamp → startTime", async () => {
    const coll = getDB().collection("_migration_test_clock");
    await coll.insertOne({
      _id: new ObjectId(),
      startTimestamp: 1_700_000_000_000,
      endTime: null,
    });

    await up(getDB(), coll.collectionName);

    const doc = await coll.findOne({});
    expect(doc!.startTime).toBe(1_700_000_000_000);
    expect(doc!.startTimestamp).toBeUndefined();
  });

  it("converts endTime Date → epoch ms number", async () => {
    const coll = getDB().collection("_migration_test_clock");
    const date = new Date("2024-01-15T10:30:00Z");
    const { insertedId } = await coll.insertOne({
      _id: new ObjectId(),
      startTime: 1_700_000_000_002,
      endTime: date,
    });

    await up(getDB(), coll.collectionName);

    const doc = await coll.findOne({ _id: insertedId });
    expect(typeof doc!.endTime).toBe("number");
    expect(doc!.endTime).toBe(date.getTime());
  });

  it("leaves endTime: null untouched", async () => {
    const coll = getDB().collection("_migration_test_clock");
    const { insertedId } = await coll.insertOne({
      _id: new ObjectId(),
      startTime: 1_700_000_000_003,
      endTime: null,
    });

    await up(getDB(), coll.collectionName);

    const doc = await coll.findOne({ _id: insertedId });
    expect(doc!.endTime).toBeNull();
  });

  it("is idempotent — safe to run twice", async () => {
    const coll = getDB().collection("_migration_test_clock");
    const date = new Date("2024-06-01T08:00:00Z");
    const { insertedId } = await coll.insertOne({
      _id: new ObjectId(),
      startTimestamp: 1_710_000_000_000,
      endTime: date,
    });

    await up(getDB(), coll.collectionName);
    await up(getDB(), coll.collectionName);

    const doc = await coll.findOne({ _id: insertedId });
    expect(doc!.startTime).toBe(1_710_000_000_000);
    expect(doc!.startTimestamp).toBeUndefined();
    expect(doc!.endTime).toBe(date.getTime());
  });
});
