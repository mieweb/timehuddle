import { ObjectId } from "mongodb";
import { clockEventsCollection } from "./index.js";

export interface ClockEvent {
  _id: ObjectId;
  userId: string;
  teamId: string;
  startTime: number; // epoch ms
  accumulatedTime: number; // seconds
  endTime: number | null; // epoch ms — null = still clocked in
}

// Read helpers using native MongoDB collection
export async function findActiveClockEventByUserTeam(
  userId: string,
  teamId: string
): Promise<ClockEvent | null> {
  return clockEventsCollection().findOne({ userId, teamId, endTime: null });
}

export async function findActiveClockEventByUser(userId: string): Promise<ClockEvent | null> {
  return clockEventsCollection().findOne({ userId, endTime: null });
}

export async function findClockEventsForUser(userId: string): Promise<ClockEvent[]> {
  return clockEventsCollection().find({ userId }).sort({ startTime: -1 }).toArray();
}

export async function findLiveClockEventsForTeams(teamIds: string[]): Promise<ClockEvent[]> {
  if (!teamIds.length) return [];
  return clockEventsCollection()
    .find({ teamId: { $in: teamIds }, endTime: null })
    .toArray();
}
