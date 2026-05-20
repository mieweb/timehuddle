import { ObjectId } from "mongodb";
import { clockEventsCollection } from "./index.js";

/**
 * A break interval embedded in a clock event.
 * type is absent while the break is in progress; set on close.
 * "rest" breaks (<30 min) are compensable (not deducted from pay).
 * "meal" breaks (≥30 min) are non-compensable (deducted from pay).
 */
export interface ClockBreak {
  startTime: number; // epoch ms
  endTime: number | null; // null = break in progress
  type?: "rest" | "meal"; // set when break closes
  classificationSource?: "auto" | "manual"; // "auto" = duration-based default
  notes?: string;
  updatedBy?: string; // userId of last editor
  updatedAt?: number; // epoch ms of last edit
}

export interface ClockEvent {
  _id: ObjectId;
  userId: string;
  teamId: string;
  startTime: number; // epoch ms — immutable shift start
  accumulatedTime: number; // seconds — computed at clock-out (span minus deducted breaks)
  breaks?: ClockBreak[]; // embedded break intervals
  notifiedAt3h?: number | null; // epoch ms when 3h reminder was sent
  notifiedAt4h?: number | null; // epoch ms when 4h reminder was sent
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
