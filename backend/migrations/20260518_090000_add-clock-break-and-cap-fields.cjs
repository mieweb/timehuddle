module.exports = {
  async up(db) {
    await db.collection("clockevents").updateMany(
      {
        $or: [
          { breakSegments: { $exists: false } },
          { pausedAt: { $exists: false } },
          { totalPausedSeconds: { $exists: false } },
          { pauseStartedSessionId: { $exists: false } },
          { notifiedAt3h: { $exists: false } },
          { notifiedAt4h: { $exists: false } },
          { autoClockedOutAt: { $exists: false } },
        ],
      },
      {
        $set: {
          breakSegments: [],
          pausedAt: null,
          totalPausedSeconds: 0,
          pauseStartedSessionId: null,
          notifiedAt3h: null,
          notifiedAt4h: null,
          autoClockedOutAt: null,
        },
      }
    );
  },

  async down() {
    throw new Error("Down migration not supported for add-clock-break-and-cap-fields");
  },
};
