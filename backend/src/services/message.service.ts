import { ObjectId } from "mongodb";
import { messagesCollection, teamsCollection, usersCollection } from "../models/index.js";
import type { Message, PublicMessage } from "../models/message.model.js";

// ─── SSE pub/sub ──────────────────────────────────────────────────────────────

type SseCallback = (msg: PublicMessage) => void;
const sseListeners = new Map<string, Set<SseCallback>>();

export function subscribeSse(threadId: string, fn: SseCallback): () => void {
  if (!sseListeners.has(threadId)) sseListeners.set(threadId, new Set());
  sseListeners.get(threadId)!.add(fn);
  return () => {
    sseListeners.get(threadId)?.delete(fn);
    if (sseListeners.get(threadId)?.size === 0) sseListeners.delete(threadId);
  };
}

function broadcast(threadId: string, msg: PublicMessage) {
  sseListeners.get(threadId)?.forEach((fn) => fn(msg));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function buildThreadId(teamId: string, adminId: string, memberId: string) {
  return `${teamId}:${adminId}:${memberId}`;
}

function toPublicMessage(m: Message): PublicMessage {
  return {
    id: m._id.toHexString(),
    threadId: m.threadId,
    teamId: m.teamId,
    adminId: m.adminId,
    memberId: m.memberId,
    fromUserId: m.fromUserId,
    toUserId: m.toUserId,
    text: m.text,
    senderName: m.senderName,
    ...(m.ticketId ? { ticketId: m.ticketId } : {}),
    createdAt: m.createdAt.toISOString(),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

class MessageService {
  async getThread(
    requesterId: string,
    teamId: string,
    adminId: string,
    memberId: string
  ): Promise<PublicMessage[] | "forbidden"> {
    if (requesterId !== adminId && requesterId !== memberId) return "forbidden";
    const threadId = buildThreadId(teamId, adminId, memberId);
    const messages = await messagesCollection()
      .find({ threadId })
      .sort({ createdAt: 1 })
      .limit(500)
      .toArray();
    return messages.map(toPublicMessage);
  }

  async send(
    senderId: string,
    data: {
      teamId: string;
      toUserId: string;
      text: string;
      adminId: string;
      ticketId?: string;
    }
  ): Promise<PublicMessage | "forbidden" | "not-found"> {
    const { teamId, toUserId, text, adminId, ticketId } = data;

    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";

    const isAdmin = team.admins.includes(senderId);
    const isMember = team.members.includes(senderId);
    if (!isAdmin && !isMember) return "forbidden";

    const memberId = isAdmin ? toUserId : senderId;
    const threadId = buildThreadId(teamId, adminId, memberId);

    // Sender must be a thread participant
    if (senderId !== adminId && senderId !== memberId) return "forbidden";
    if (!team.admins.includes(adminId)) return "forbidden";
    const allMembers = [...team.members, ...team.admins];
    if (!allMembers.includes(memberId)) return "forbidden";

    const sender = await usersCollection().findOne({ _id: new ObjectId(senderId) });
    const senderName = sender?.name ?? sender?.email?.split("@")[0] ?? "Unknown";

    const doc: Message = {
      _id: new ObjectId(),
      threadId,
      teamId,
      adminId,
      memberId,
      fromUserId: senderId,
      toUserId,
      text,
      senderName,
      createdAt: new Date(),
    };
    if (ticketId) doc.ticketId = ticketId;

    await messagesCollection().insertOne(doc);
    const pub = toPublicMessage(doc);
    broadcast(threadId, pub);
    return pub;
  }
}

export const messageService = new MessageService();
