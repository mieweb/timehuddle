/**
 * Migration: Add user blocking support
 *
 * - Adds `blocked` array field to user collection for multi-org blocking
 * - Creates index on `blocked.orgId` for efficient org-specific lookups
 */

module.exports = {
  async up(db) {
    // Create index on blocked array for efficient org-specific queries
    // This allows us to quickly check if a user is blocked from a specific org
    try {
      const existingIndexes = await db.collection("user").indexes();
      const hasIndex = existingIndexes.some(
        (idx) => idx.key && idx.key["blocked.orgId"] === 1
      );

      if (!hasIndex) {
        await db
          .collection("user")
          .createIndex({ "blocked.orgId": 1 }, { name: "blocked_orgId", sparse: true });
        console.log("✅ Created index on user.blocked.orgId");
      } else {
        console.log("ℹ️ Index on user.blocked.orgId already exists");
      }
    } catch (err) {
      console.log("⚠️ Index creation skipped:", err.message);
    }

    // No data migration needed - blocked field will be undefined for existing users
    // and will be added as an empty array when users are blocked
    console.log("✅ Migration complete: user blocking support added");
  },

  async down(db) {
    // Drop the index
    try {
      await db.collection("user").dropIndex("blocked_orgId");
      console.log("✅ Dropped index blocked_orgId");
    } catch (err) {
      console.log("⚠️ Index drop skipped:", err.message);
    }

    // Optionally remove blocked field from all users
    await db.collection("user").updateMany({ blocked: { $exists: true } }, { $unset: { blocked: "" } });
    console.log("✅ Removed blocked field from all users");
  },
};
