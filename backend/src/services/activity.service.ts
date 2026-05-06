import { ObjectId } from "mongodb";
import { activitiesCollection } from "../models/index.js";
import type {
  ActivityEvent,
  EmitActivityInput,
  PublicActivityEvent,
} from "../models/activity.model.js";

// ─── Public shape ──────────────────────────────────────────────────────────────

function toPublic(doc: ActivityEvent): PublicActivityEvent {
  return {
    id: doc._id.toHexString(),
    userId: doc.userId,
    teamId: doc.teamId,
    type: doc.type,
    actor: doc.actor,
    payload: doc.payload as unknown as Record<string, unknown>,
    occurredAt: doc.occurredAt.toISOString(),
    source: doc.source,
  };
}

// ─── emitActivity ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget activity emitter.
 *
 * All internal features call this after their own side effects.
 * Errors are swallowed — callers must never depend on the result.
 *
 * @example
 *   await emitActivity({ userId, teamId, type: "clock.in", actor, payload: { teamId, teamName } });
 */
export async function emitActivity(input: EmitActivityInput): Promise<void> {
  try {
    // The spread of a discriminated union cannot be narrowed by TypeScript,
    // so we cast through unknown to satisfy the collection's generic constraint.
    const doc = {
      _id: new ObjectId(),
      occurredAt: input.occurredAt ?? new Date(),
      source: input.source ?? "timehuddle",
      ...input,
    } as unknown as ActivityEvent;
    await activitiesCollection().insertOne(doc);
  } catch {
    // intentionally silent — activity logging must never break callers
  }
}

// ─── ActivityService ──────────────────────────────────────────────────────────

export class ActivityService {
  /**
   * Fetch a page of activity log events for a user, newest first.
   *
   * @param userId   - Filter to this user's events.
   * @param limit    - Max items per page (1–100, default 50).
   * @param before   - Cursor: ISO timestamp; return events older than this.
   */
  async getLog(
    userId: string,
    limit = 50,
    before?: string
  ): Promise<{ events: PublicActivityEvent[]; nextCursor: string | null }> {
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const filter: Record<string, unknown> = { userId };
    if (before) {
      const ts = new Date(before);
      if (!isNaN(ts.getTime())) {
        filter.occurredAt = { $lt: ts };
      }
    }

    const docs = await activitiesCollection()
      .find(filter)
      .sort({ occurredAt: -1 })
      .limit(safeLimit)
      .toArray();

    const events = docs.map(toPublic);
    const nextCursor =
      docs.length === safeLimit ? docs[docs.length - 1].occurredAt.toISOString() : null;

    return { events, nextCursor };
  }
}

export const activityService = new ActivityService();
