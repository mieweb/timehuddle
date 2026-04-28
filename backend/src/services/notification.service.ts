import { ObjectId } from "mongodb";
import { notificationsCollection, teamsCollection, usersCollection } from "../models/index.js";
import type { Notification, PublicNotification } from "../models/notification.model.js";

// ─── SSE pub/sub ──────────────────────────────────────────────────────────────

type SseCallback = (n: PublicNotification) => void;
const sseListeners = new Map<string, Set<SseCallback>>();

export function subscribeSse(userId: string, fn: SseCallback): () => void {
  if (!sseListeners.has(userId)) sseListeners.set(userId, new Set());
  sseListeners.get(userId)!.add(fn);
  return () => {
    sseListeners.get(userId)?.delete(fn);
    if (sseListeners.get(userId)?.size === 0) sseListeners.delete(userId);
  };
}

export function broadcastToUser(userId: string, n: PublicNotification) {
  sseListeners.get(userId)?.forEach((fn) => fn(n));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublic(n: Notification): PublicNotification {
  return {
    id: n._id.toHexString(),
    userId: n.userId,
    title: n.title,
    body: n.body,
    ...(n.data ? { data: n.data } : {}),
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

class NotificationService {
  /** Fetch the inbox for a user (newest first, max 200). */
  async getInbox(userId: string): Promise<PublicNotification[]> {
    const docs = await notificationsCollection()
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return docs.map(toPublic);
  }

  /** Create a notification and push it over SSE if the user is connected. */
  async create(data: {
    userId: string;
    title: string;
    body: string;
    notificationData?: Record<string, unknown>;
  }): Promise<PublicNotification> {
    const doc: Notification = {
      _id: new ObjectId(),
      userId: data.userId,
      title: data.title,
      body: data.body,
      ...(data.notificationData ? { data: data.notificationData } : {}),
      read: false,
      createdAt: new Date(),
    };
    await notificationsCollection().insertOne(doc);
    const pub = toPublic(doc);
    broadcastToUser(data.userId, pub);
    return pub;
  }

  /** Mark a single notification as read. Returns "not-found" or "forbidden". */
  async markOneRead(userId: string, id: string): Promise<"ok" | "not-found" | "forbidden"> {
    if (!ObjectId.isValid(id)) return "not-found";
    const doc = await notificationsCollection().findOne({ _id: new ObjectId(id) });
    if (!doc) return "not-found";
    if (doc.userId !== userId) return "forbidden";
    await notificationsCollection().updateOne({ _id: new ObjectId(id) }, { $set: { read: true } });
    return "ok";
  }

  /** Mark all notifications for the user as read. */
  async markAllRead(userId: string): Promise<void> {
    await notificationsCollection().updateMany({ userId, read: false }, { $set: { read: true } });
  }

  /** Delete notifications by IDs — only deletes those owned by userId. */
  async deleteMany(userId: string, ids: string[]): Promise<{ deletedCount: number }> {
    const validIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    if (validIds.length === 0) return { deletedCount: 0 };
    const result = await notificationsCollection().deleteMany({
      _id: { $in: validIds },
      userId,
    });
    return { deletedCount: result.deletedCount };
  }

  /** Return a preview of a team-invite notification. */
  async getInvitePreview(
    userId: string,
    notificationId: string
  ): Promise<
    | {
        notificationId: string;
        teamId: string;
        teamName: string;
        teamDescription: string;
        inviter: { id: string; name: string; email: string } | null;
        members: { id: string; name: string; email: string }[];
        admins: { id: string; name: string; email: string }[];
        alreadyMember: boolean;
      }
    | "not-found"
    | "forbidden"
    | "bad-request"
  > {
    if (!ObjectId.isValid(notificationId)) return "not-found";
    const n = await notificationsCollection().findOne({
      _id: new ObjectId(notificationId),
    });
    if (!n) return "not-found";
    if (n.userId !== userId) return "forbidden";

    const data = (n.data ?? {}) as Record<string, unknown>;
    if (data.type !== "team-invite") return "bad-request";

    const teamId = typeof data.teamId === "string" ? data.teamId : "";
    const inviterId = typeof data.inviterId === "string" ? data.inviterId : "";
    if (!teamId || !ObjectId.isValid(teamId)) return "bad-request";

    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";

    const allIds = Array.from(new Set([...team.members, ...team.admins]));
    const userDocs = await usersCollection()
      .find({ _id: { $in: allIds } })
      .toArray();
    const userMap = new Map(
      userDocs.map((u) => [
        u._id,
        {
          id: u._id,
          name: u.name ?? u.email?.split("@")[0] ?? "Unknown",
          email: u.email ?? "",
        },
      ])
    );

    return {
      notificationId,
      teamId: team._id.toHexString(),
      teamName: team.name,
      teamDescription: team.description ?? "",
      inviter: userMap.get(inviterId) ?? null,
      members: team.members.map((id) => userMap.get(id) ?? { id, name: "Unknown", email: "" }),
      admins: team.admins.map((id) => userMap.get(id) ?? { id, name: "Unknown", email: "" }),
      alreadyMember: team.members.includes(userId),
    };
  }

  /** Accept or ignore a team invite notification. */
  async respondToInvite(
    userId: string,
    notificationId: string,
    action: "join" | "ignore"
  ): Promise<"ok" | "not-found" | "forbidden" | "bad-request"> {
    if (!ObjectId.isValid(notificationId)) return "not-found";
    const n = await notificationsCollection().findOne({
      _id: new ObjectId(notificationId),
    });
    if (!n) return "not-found";
    if (n.userId !== userId) return "forbidden";

    const data = (n.data ?? {}) as Record<string, unknown>;
    if (data.type !== "team-invite") return "bad-request";

    if (action === "join") {
      const teamId = typeof data.teamId === "string" ? data.teamId : "";
      if (!teamId || !ObjectId.isValid(teamId)) return "bad-request";

      const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
      if (!team) return "not-found";

      if (!team.members.includes(userId)) {
        await teamsCollection().updateOne(
          { _id: new ObjectId(teamId) },
          { $push: { members: userId } }
        );
      }
    }

    await notificationsCollection().deleteOne({
      _id: new ObjectId(notificationId),
      userId,
    });
    return "ok";
  }
}

export const notificationService = new NotificationService();
