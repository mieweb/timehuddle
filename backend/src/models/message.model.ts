import { ObjectId } from "mongodb";

export interface Message {
  _id: ObjectId;
  threadId: string; // composite: "teamId:adminId:memberId"
  teamId: string;
  adminId: string;
  memberId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  senderName: string;
  ticketId?: string;
  createdAt: Date;
}

export interface PublicMessage {
  id: string;
  threadId: string;
  teamId: string;
  adminId: string;
  memberId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  senderName: string;
  ticketId?: string;
  createdAt: string; // ISO
}
