import { clockEventsCollection, teamsCollection, usersCollection } from "../models/index.js";
import type { ClockEvent } from "../models/clock.model.js";
import { findBreaksForEvents } from "../models/clock.model.js";
import { clockService, computeWorkSeconds } from "./clock.service.js";
import { notificationService } from "./notification.service.js";
import { ObjectId } from "mongodb";

const FOUR_HOURS_SECONDS = 4 * 60 * 60;
const SEVEN_HOURS_45_MIN_SECONDS = 7 * 3600 + 45 * 60; // 27 900
const EIGHT_HOURS_SECONDS = 8 * 3600; // 28 800 — auto-clockout threshold (15 min window)

class ClockMonitorService {
  async checkAndEnforce(now = Date.now()): Promise<{
    reminded4h: number;
    reminded7h45m: number;
    reminded2hCycle: number;
    autoClockedOut: number;
  }> {
    const coll = clockEventsCollection();
    const activeEvents = await coll.find({ endTime: null }).toArray();

    let reminded4h = 0;
    let reminded7h45m = 0;
    let reminded2hCycle = 0;
    let autoClockedOut = 0;

    const activeIds = activeEvents.map((e) => e._id.toHexString());
    const allBreaks = await findBreaksForEvents(activeIds);
    const breaksByEventId = new Map<string, typeof allBreaks>();
    for (const b of allBreaks) {
      const arr = breaksByEventId.get(b.clockEventId) ?? [];
      arr.push(b);
      breaksByEventId.set(b.clockEventId, arr);
    }

    for (const event of activeEvents) {
      const breaks = breaksByEventId.get(event._id.toHexString()) ?? [];
      const workSeconds = computeWorkSeconds(event as ClockEvent, breaks, now);

      // ── Check A: 4-hour break reminder ──────────────────────────────────────
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

      // ── Check B: 7h45m first shift-end reminder ──────────────────────────────
      if (workSeconds >= SEVEN_HOURS_45_MIN_SECONDS && event.notifiedAt7h45m == null) {
        const locked = await coll.updateOne(
          { _id: event._id, endTime: null, notifiedAt7h45m: null },
          {
            $set: {
              notifiedAt7h45m: now,
              shiftAutoClockoutWorkSecs: EIGHT_HOURS_SECONDS,
            },
          }
        );
        if (locked.modifiedCount === 1) {
          reminded7h45m += 1;
          await notificationService.create({
            userId: event.userId,
            title: "Shift End Reminder",
            body: "You have worked 7 hours 45 minutes. Agree to clock out at 8 hours, or continue working.",
            notificationData: {
              type: "shift-end-reminder",
              teamId: event.teamId,
              clockEventId: event._id.toHexString(),
              url: "/app/clock",
            },
          });
        }
      }

      // ── Check C: auto-clockout when threshold reached (agreed or ignored) ────
      if (
        event.shiftAutoClockoutWorkSecs != null &&
        workSeconds >= event.shiftAutoClockoutWorkSecs
      ) {
        const threshold = event.shiftAutoClockoutWorkSecs;
        const locked = await coll.updateOne(
          { _id: event._id, endTime: null, shiftAutoClockoutWorkSecs: threshold },
          { $set: { shiftAutoClockoutWorkSecs: null } }
        );
        if (locked.modifiedCount === 1) {
          autoClockedOut += 1;
          const wasAgreed = event.shiftReminderResponse === "agreed";

          // Delegate to clockService.stop() — closes timers, classifies breaks, notifies admins
          await clockService.stop(event.userId, event.teamId);

          // Notify the user about the auto-clockout
          const userBody = wasAgreed
            ? "You have been automatically clocked out as you agreed."
            : "You have been automatically clocked out. No response was received to the shift-end reminder.";
          await notificationService.create({
            userId: event.userId,
            title: "Auto Clocked Out",
            body: userBody,
            notificationData: {
              type: "auto-clock-out",
              teamId: event.teamId,
              clockEventId: event._id.toHexString(),
              url: "/app/clock",
            },
          });

          // Notify admins — different message depending on whether user agreed or ignored
          if (wasAgreed) {
            await _notifyAdminsShiftAgreed(event.userId, event.teamId);
          } else {
            await _notifyAdminsShiftIgnored(event.userId, event.teamId);
          }
        }
      }

      // ── Check D: 2h repeat reminder after user disagreed ────────────────────
      if (
        event.shiftNextReminderWorkSecs != null &&
        workSeconds >= event.shiftNextReminderWorkSecs
      ) {
        const nextThreshold = event.shiftNextReminderWorkSecs;
        const locked = await coll.updateOne(
          { _id: event._id, endTime: null, shiftNextReminderWorkSecs: nextThreshold },
          {
            $set: {
              shiftNextReminderWorkSecs: null,
              // 15-minute response window from this reminder's threshold
              shiftAutoClockoutWorkSecs: nextThreshold + 15 * 60,
              shiftReminderResponse: null,
            },
          }
        );
        if (locked.modifiedCount === 1) {
          reminded2hCycle += 1;
          const totalHours = Math.floor(nextThreshold / 3600);
          const totalMins = Math.floor((nextThreshold % 3600) / 60);
          const timeLabel =
            totalMins > 0 ? `${totalHours} hours ${totalMins} minutes` : `${totalHours} hours`;
          await notificationService.create({
            userId: event.userId,
            title: "Shift End Reminder",
            body: `You have worked ${timeLabel}. Agree to clock out, or continue working.`,
            notificationData: {
              type: "shift-end-reminder",
              teamId: event.teamId,
              clockEventId: event._id.toHexString(),
              url: "/app/clock",
            },
          });
        }
      }
    }

    return { reminded4h, reminded7h45m, reminded2hCycle, autoClockedOut };
  }
}

/** Send an admin notification when a user was auto-clocked out after agreeing to the reminder. */
async function _notifyAdminsShiftAgreed(userId: string, teamId: string): Promise<void> {
  if (!ObjectId.isValid(teamId)) return;
  const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
  if (!team || !team.admins || team.admins.length === 0) return;

  const user = ObjectId.isValid(userId)
    ? await usersCollection().findOne({ _id: new ObjectId(userId) })
    : null;
  const userName = user?.name ?? user?.email?.split("@")[0] ?? "A team member";

  await Promise.all(
    (team.admins as string[])
      .filter((adminId) => adminId !== userId)
      .map((adminId) =>
        notificationService
          .create({
            userId: adminId,
            title: "Auto Clocked Out",
            body: `${userName} was automatically clocked out of ${team.name} after agreeing to the shift-end reminder.`,
            notificationData: {
              type: "auto-clock-out-admin",
              userId,
              userName,
              teamId,
              teamName: team.name,
              url: "/app/clock",
            },
          })
          .catch(() => {})
      )
  );
}

/** Send an admin notification when a user was auto-clocked out without responding. */
async function _notifyAdminsShiftIgnored(userId: string, teamId: string): Promise<void> {
  if (!ObjectId.isValid(teamId)) return;
  const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
  if (!team || !team.admins || team.admins.length === 0) return;

  const user = ObjectId.isValid(userId)
    ? await usersCollection().findOne({ _id: new ObjectId(userId) })
    : null;
  const userName = user?.name ?? user?.email?.split("@")[0] ?? "A team member";

  await Promise.all(
    (team.admins as string[])
      .filter((adminId) => adminId !== userId)
      .map((adminId) =>
        notificationService
          .create({
            userId: adminId,
            title: "Auto Clocked Out",
            body: `${userName} was automatically clocked out of ${team.name} — no response to the shift-end reminder.`,
            notificationData: {
              type: "auto-clock-out-admin",
              userId,
              userName,
              teamId,
              teamName: team.name,
              url: "/app/clock",
            },
          })
          .catch(() => {})
      )
  );
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
