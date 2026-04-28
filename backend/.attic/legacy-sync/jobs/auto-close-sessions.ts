import { workSessionsCollection } from "../models/index.js";
import { computeSession, type RawSession } from "@timeharbor/time-engine";
import { recomputeDailyStats } from "../controllers/time.controller.js";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export async function autoCloseOrphanedSessions() {
  const cutoff = Date.now() - TWELVE_HOURS_MS;

  const orphaned = await workSessionsCollection()
    .find({ clockOut: null, clockIn: { $lt: cutoff } })
    .toArray();

  if (orphaned.length === 0) return;

  const affectedDates = new Set<string>();
  const affectedUsers = new Map<string, Set<string>>();

  for (const session of orphaned) {
    const clockOut = session.clockIn + TWELVE_HOURS_MS;
    const now = Date.now();

    const raw: RawSession = {
      clockIn: session.clockIn,
      clockOut,
      ticketSegments: session.ticketSegments.map((s) => ({
        ...s,
        end: s.end ?? clockOut,
      })),
      breaks: session.breaks.map((b) => ({
        ...b,
        end: b.end ?? clockOut,
      })),
    };

    const stats = computeSession(raw, clockOut);

    await workSessionsCollection().updateOne(
      { _id: session._id },
      {
        $set: {
          clockOut,
          autoClosedAt: now,
          ticketSegments: raw.ticketSegments,
          breaks: raw.breaks,
          totalSessionMs: stats.totalSessionMs,
          totalBreakMs: stats.totalBreakMs,
          netWorkMs: stats.netWorkMs,
          ticketBreakdown: stats.ticketBreakdown,
          updatedAt: now,
        },
        $inc: { _rev: 1 },
      }
    );

    affectedDates.add(session.date);
    if (!affectedUsers.has(session.userId)) {
      affectedUsers.set(session.userId, new Set());
    }
    affectedUsers.get(session.userId)!.add(session.date);
  }

  // Recompute daily stats for all affected user+date combinations
  for (const [userId, dates] of affectedUsers) {
    for (const date of dates) {
      await recomputeDailyStats(userId, date);
    }
  }

  console.log(
    `Auto-closed ${orphaned.length} orphaned session(s) for dates: ${Array.from(affectedDates).join(", ")}`
  );
}
