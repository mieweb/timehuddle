const { ObjectId } = require("mongodb");

module.exports = {
  async up(db) {
    const organizations = db.collection("organizations");
    const teams = db.collection("teams");
    const orgMembers = db.collection("org_members");

    await orgMembers.createIndex({ orgId: 1, userId: 1 }, { unique: true });

    const orgs = await organizations.find({}).toArray();
    for (const org of orgs) {
      const orgId = org._id.toHexString();
      const owners = org.owners || [];
      const admins = org.admins || [];

      const teamDocs = await teams
        .find({ orgId }, { projection: { members: 1, admins: 1 } })
        .toArray();
      const teamMembers = new Set();
      for (const team of teamDocs) {
        for (const memberId of team.members || []) teamMembers.add(memberId);
        for (const adminId of team.admins || []) teamMembers.add(adminId);
      }

      const members = new Set([...owners, ...admins, ...teamMembers]);
      for (const userId of members) {
        const role = owners.includes(userId)
          ? "owner"
          : admins.includes(userId)
            ? "admin"
            : "member";
        const auto = role === "member";
        await orgMembers.updateOne(
          { orgId, userId },
          {
            $setOnInsert: {
              _id: new ObjectId(),
              createdAt: new Date(),
            },
            $set: {
              orgId,
              userId,
              role,
              auto,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
      }
    }
  },

  async down(db) {
    await db
      .collection("org_members")
      .drop()
      .catch(() => {});
  },
};
