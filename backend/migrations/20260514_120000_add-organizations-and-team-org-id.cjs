const { ObjectId } = require("mongodb");

const DEFAULT_ORG_KEY = process.env.DEFAULT_ORG_KEY || "default";
const DEFAULT_ORG_NAME = process.env.DEFAULT_ORG_NAME || "Default Organization";

module.exports = {
  async up(db) {
    const organizations = db.collection("organizations");
    const teams = db.collection("teams");

    let defaultOrg = await organizations.findOne({ key: DEFAULT_ORG_KEY });
    if (!defaultOrg) {
      const now = new Date();
      const inserted = {
        _id: new ObjectId(),
        key: DEFAULT_ORG_KEY,
        name: DEFAULT_ORG_NAME,
        createdAt: now,
        updatedAt: now,
      };
      await organizations.insertOne(inserted);
      defaultOrg = inserted;
    }

    await teams.updateMany(
      {
        $or: [{ orgId: { $exists: false } }, { orgId: null }, { orgId: "" }],
      },
      {
        $set: {
          orgId: defaultOrg._id.toHexString(),
          updatedAt: new Date(),
        },
      }
    );
  },

  async down() {
    throw new Error("Down migration not supported for 004-add-organizations-and-team-org-id");
  },
};
