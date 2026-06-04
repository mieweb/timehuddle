/**
 * Migration: Add shift-end reminder fields to clockevents
 *
 * Adds four new nullable fields used by the ClockMonitorService 7h45m
 * shift-end reminder / auto-clockout feature:
 *   notifiedAt7h45m          – epoch ms when the first 7h45m reminder was sent
 *   shiftAutoClockoutWorkSecs – work-second threshold at which auto-clockout fires
 *   shiftNextReminderWorkSecs – work-second threshold for the next 2h repeat reminder
 *   shiftReminderResponse     – last user response ("agreed" | "disagreed")
 */
module.exports = {
  async up(db) {
    await db.collection("clockevents").updateMany(
      {
        $or: [
          { notifiedAt7h45m: { $exists: false } },
          { shiftAutoClockoutWorkSecs: { $exists: false } },
          { shiftNextReminderWorkSecs: { $exists: false } },
          { shiftReminderResponse: { $exists: false } },
        ],
      },
      {
        $set: {
          notifiedAt7h45m: null,
          shiftAutoClockoutWorkSecs: null,
          shiftNextReminderWorkSecs: null,
          shiftReminderResponse: null,
        },
      }
    );
  },

  async down(db) {
    await db.collection("clockevents").updateMany(
      {},
      {
        $unset: {
          notifiedAt7h45m: "",
          shiftAutoClockoutWorkSecs: "",
          shiftNextReminderWorkSecs: "",
          shiftReminderResponse: "",
        },
      }
    );
  },
};
