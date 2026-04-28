import { ObjectId } from "mongodb";

export interface ClockTicketSession {
  startTimestamp: number;
  endTimestamp: number | null;
}

export interface ClockEventTicket {
  ticketId: string;
  startTimestamp?: number; // present while running
  accumulatedTime: number; // seconds
  sessions: ClockTicketSession[];
}

export interface ClockEvent {
  _id: ObjectId;
  userId: string;
  teamId: string;
  startTimestamp: number; // epoch ms
  accumulatedTime: number; // seconds
  tickets: ClockEventTicket[];
  endTime: Date | null; // null = still clocked in
  youtubeShortLink?: string;
}
