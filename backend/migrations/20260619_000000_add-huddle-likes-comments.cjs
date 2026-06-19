/**
 * Migration: Add huddle likes and comments
 * 
 * - Creates huddlecomments collection with index on { postId: 1, createdAt: 1 }
 * - Adds likes: [] and commentCount: 0 to existing huddle posts
 */

module.exports = {
  async up(db) {
    // 1. Create huddlecomments collection (will be created on first insert, but we create index)
    await db.createCollection("huddlecomments").catch(() => {
      // Collection might already exist, ignore error
    });

    // 2. Create index on huddlecomments for efficient queries (try to drop existing first)
    try {
      const existingIndexes = await db.collection("huddlecomments").indexes();
      const hasIndex = existingIndexes.some(idx => 
        idx.key && idx.key.postId === 1 && idx.key.createdAt === 1
      );
      
      if (!hasIndex) {
        await db.collection("huddlecomments").createIndex(
          { postId: 1, createdAt: 1 },
          { name: "postId_createdAt" }
        );
      }
    } catch (err) {
      console.log("⚠️ Index creation skipped:", err.message);
    }

    // 3. Add likes and commentCount fields to existing posts (if any)
    await db.collection("huddleposts").updateMany(
      { likes: { $exists: false } },
      { $set: { likes: [], commentCount: 0 } }
    );

    console.log("✅ Migration complete: huddlecomments collection created with index");
    console.log("✅ Migration complete: likes and commentCount added to existing posts");
  },

  async down(db) {
    // Remove the index
    await db.collection("huddlecomments").dropIndex("postId_createdAt").catch(() => {
      // Index might not exist, ignore error
    });

    // Drop the collection
    await db.collection("huddlecomments").drop().catch(() => {
      // Collection might not exist, ignore error
    });

    // Remove likes and commentCount fields from posts
    await db.collection("huddleposts").updateMany(
      {},
      { $unset: { likes: "", commentCount: "" } }
    );

    console.log("✅ Rollback complete: huddlecomments collection and index removed");
    console.log("✅ Rollback complete: likes and commentCount removed from posts");
  },
};
