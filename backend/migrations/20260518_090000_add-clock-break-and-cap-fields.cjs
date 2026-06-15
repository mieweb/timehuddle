module.exports = {
  async up(db) {
    await db.collection("clockevents").updateMany(
      {
        $or: [
          { pausedAt: { $exists: false } },
          { totalPausedSeconds: { $exists: false } },
          { pauseStartedSessionId: { $exists: false } },
          { originalStartTime: { $exists: false } },
          { breaks: { $exists: false } },
          { notifiedAt3h: { $exists: false } },
          { notifiedAt4h: { $exists: false } },
          { autoClockedOutAt: { $exists: false } },
        ],
      },
      {
        $set: {
          pausedAt: null,
          totalPausedSeconds: 0,
          pauseStartedSessionId: null,
          breaks: [],
          notifiedAt3h: null,
          notifiedAt4h: null,
          autoClockedOutAt: null,
        },
      }
    );

    await db
      .collection("clockevents")
      .updateMany({ originalStartTime: { $exists: false }, startTime: { $type: "number" } }, [
        { $set: { originalStartTime: "$startTime" } },
      ]);
  },

  async down() {
    throw new Error("Down migration not supported for add-clock-break-and-cap-fields");
  },
};
