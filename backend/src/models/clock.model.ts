import { ObjectId } from "mongodb";

export interface ClockEvent {
  _id: ObjectId;
  userId: string;
  teamId: string;
  startTime: number; // epoch ms
  accumulatedTime: number; // seconds
  endTime: number | null; // epoch ms — null = still clocked in
}
