import { ObjectId } from "mongodb";
import type { TicketSegment, Break, TicketTime } from "@timeharbor/time-engine";

export interface SessionAttachment {
  name: string;
  type: string;
  dataUrl: string;
}

export interface WorkSession {
  _id: ObjectId;
  clientSessionId: string;
  userId: string;
  date: string; // YYYY-MM-DD
  clockIn: number; // epoch ms
  clockOut: number | null;
  ticketSegments: TicketSegment[];
  breaks: Break[];
  totalSessionMs: number;
  totalBreakMs: number;
  netWorkMs: number;
  ticketBreakdown: TicketTime[];
  comment?: string;
  links?: string[];
  attachments?: SessionAttachment[];
  autoClosedAt?: number;
  sourceApp: "timeharbor";
  _rev: number;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}
