module.exports = {
  async up(db) {
    await db.collection("teams").updateMany(
      {
        $or: [{ parentTeamId: { $exists: false } }, { parentTeamId: undefined }],
      },
      {
        $set: {
          parentTeamId: null,
          updatedAt: new Date(),
        },
      }
    );
  },

  async down(db) {
    await db.collection("teams").updateMany(
      {},
      {
        $unset: { parentTeamId: "" },
        $set: { updatedAt: new Date() },
      }
    );
  },
};
