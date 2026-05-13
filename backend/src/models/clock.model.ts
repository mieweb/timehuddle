import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import { ensureMongooseConnected } from "../lib/mongoose.js";

const { Schema, model, models } = mongoose;

export interface ClockEvent {
  _id: ObjectId;
  userId: string;
  teamId: string;
  startTime: number; // epoch ms
  accumulatedTime: number; // seconds
  endTime: number | null; // epoch ms — null = still clocked in
}

// Mongoose schema and model for ClockEvent
const clockEventSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    teamId: { type: String, required: true, index: true },
    startTime: { type: Number, required: true, index: true },
    accumulatedTime: { type: Number, required: true, default: 0 },
    endTime: { type: Number, default: null, index: true },
  },
  {
    collection: "clockevents",
    versionKey: false,
  }
);

const ClockEventModel = models.ClockEvent || model("ClockEvent", clockEventSchema);

// Read helpers using Mongoose model
export async function findActiveClockEventByUserTeam(
  userId: string,
  teamId: string
): Promise<ClockEvent | null> {
  await ensureMongooseConnected();
  return ClockEventModel.findOne({ userId, teamId, endTime: null }).lean<ClockEvent>().exec();
}

export async function findActiveClockEventByUser(userId: string): Promise<ClockEvent | null> {
  await ensureMongooseConnected();
  return ClockEventModel.findOne({ userId, endTime: null }).lean<ClockEvent>().exec();
}

export async function findClockEventsForUser(userId: string): Promise<ClockEvent[]> {
  await ensureMongooseConnected();
  return ClockEventModel.find({ userId }).sort({ startTime: -1 }).lean<ClockEvent[]>().exec();
}

export async function findLiveClockEventsForTeams(teamIds: string[]): Promise<ClockEvent[]> {
  if (!teamIds.length) return [];
  await ensureMongooseConnected();
  return ClockEventModel.find({ teamId: { $in: teamIds }, endTime: null })
    .lean<ClockEvent[]>()
    .exec();
}
