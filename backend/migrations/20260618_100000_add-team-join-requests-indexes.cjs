module.exports = {
  async up(db) {
    // Create indexes for team join requests
    const collection = db.collection("teamjoinrequests");

    // Index for querying by team and status (admin view)
    await collection.createIndex({ teamId: 1, status: 1 });

    // Index for querying by user and status (user view)
    await collection.createIndex({ userId: 1, status: 1 });

    // TTL index to auto-delete requests after 7 days
    // MongoDB will automatically remove documents where requestedAt is older than 7 days
    await collection.createIndex({ requestedAt: 1 }, { expireAfterSeconds: 604800 }); // 7 days = 604800 seconds

    // Compound index for uniqueness check (prevent duplicate pending requests)
    await collection.createIndex({ teamId: 1, userId: 1, status: 1 });
  },

  async down(db) {
    const collection = db.collection("teamjoinrequests");

    // Drop all indexes (except _id which cannot be dropped)
    await collection.dropIndex({ teamId: 1, status: 1 });
    await collection.dropIndex({ userId: 1, status: 1 });
    await collection.dropIndex({ requestedAt: 1 });
    await collection.dropIndex({ teamId: 1, userId: 1, status: 1 });
  },
};
