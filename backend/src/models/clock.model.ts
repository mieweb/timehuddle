import { ObjectId } from "mongodb";
import { clockEventsCollection } from "./index.js";

export interface ClockBreakSegment {
  pausedAt: number; // epoch ms when break started
  resumedAt: number | null; // epoch ms when break ended
}

export interface ClockEvent {
  _id: ObjectId;
  userId: string;
  teamId: string;
  startTime: number; // epoch ms
  accumulatedTime: number; // seconds
  breakSegments?: ClockBreakSegment[]; // ordered break timeline for this session
  pausedAt?: number | null; // epoch ms when user started break
  totalPausedSeconds?: number; // cumulative paused seconds for this session
  pauseStartedSessionId?: string | null; // ticket timer paused when break started
  notifiedAt3h?: number | null; // epoch ms when 3h reminder was sent
  notifiedAt4h?: number | null; // epoch ms when 4h reminder was sent
  autoClockedOutAt?: number | null; // epoch ms if system auto-clocked out at 8h
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
