import { clockEventsCollection } from "../models/index.js";
import type { ClockEvent } from "../models/clock.model.js";
import { clockService } from "./clock.service.js";
import { notificationService } from "./notification.service.js";

const THREE_HOURS_SECONDS = 3 * 60 * 60;
const FOUR_HOURS_SECONDS = 4 * 60 * 60;
const EIGHT_HOURS_SECONDS = 8 * 60 * 60;

function getElapsedSeconds(fromEpochMs: number, nowEpochMs: number): number {
  return Math.max(0, Math.floor((nowEpochMs - fromEpochMs) / 1000));
}

function getWorkSeconds(event: ClockEvent, now: number): number {
  const base = event.accumulatedTime ?? 0;
  const isPaused = typeof event.pausedAt === "number";
  if (isPaused) return Math.min(EIGHT_HOURS_SECONDS, base);
  return Math.min(EIGHT_HOURS_SECONDS, base + getElapsedSeconds(event.startTime, now));
}

class ClockMonitorService {
  async checkAndEnforce(now = Date.now()): Promise<{
    reminded3h: number;
    reminded4h: number;
    autoClockedOut: number;
  }> {
    const coll = clockEventsCollection();
    const activeEvents = await coll
      .find({
        endTime: null,
      })
      .toArray();

    let reminded3h = 0;
    let reminded4h = 0;
    let autoClockedOut = 0;

    for (const event of activeEvents) {
      const workSeconds = getWorkSeconds(event, now);

      if (workSeconds >= THREE_HOURS_SECONDS && event.notifiedAt3h == null) {
        const locked = await coll.updateOne(
          { _id: event._id, endTime: null, notifiedAt3h: null },
          { $set: { notifiedAt3h: now } }
        );
        if (locked.modifiedCount === 1) {
          reminded3h += 1;
          await notificationService.create({
            userId: event.userId,
            title: "TiméHuddle",
            body: "Need a break? You have worked for 3 hours.",
            notificationData: {
              type: "break-reminder-3h",
              teamId: event.teamId,
              clockEventId: event._id.toHexString(),
              url: "/app/clock",
            },
          });
        }
      }

      if (workSeconds >= FOUR_HOURS_SECONDS && event.notifiedAt4h == null) {
        const locked = await coll.updateOne(
          { _id: event._id, endTime: null, notifiedAt4h: null },
          { $set: { notifiedAt4h: now } }
        );
        if (locked.modifiedCount === 1) {
          reminded4h += 1;
          await notificationService.create({
            userId: event.userId,
            title: "TiméHuddle",
            body: "Take a break. You have worked for 4 hours.",
            notificationData: {
              type: "break-reminder-4h",
              teamId: event.teamId,
              clockEventId: event._id.toHexString(),
              url: "/app/clock",
            },
          });
        }
      }

      if (workSeconds >= EIGHT_HOURS_SECONDS && event.autoClockedOutAt == null) {
        const locked = await coll.updateOne(
          { _id: event._id, endTime: null, autoClockedOutAt: null },
          { $set: { autoClockedOutAt: now } }
        );
        if (locked.modifiedCount === 1) {
          autoClockedOut += 1;
          await clockService.stopWithReason(event.userId, event.teamId, "auto-8h");
        }
      }
    }

    return { reminded3h, reminded4h, autoClockedOut };
  }
}

export const clockMonitorService = new ClockMonitorService();

let clockMonitorInterval: NodeJS.Timeout | null = null;

export function startClockMonitor(intervalMs = 30_000): void {
  if (clockMonitorInterval) return;
  clockMonitorInterval = setInterval(() => {
    void clockMonitorService.checkAndEnforce().catch((err) => {
      console.error("[clock-monitor] failed:", err);
    });
  }, intervalMs);
}

export function stopClockMonitor(): void {
  if (!clockMonitorInterval) return;
  clearInterval(clockMonitorInterval);
  clockMonitorInterval = null;
}
