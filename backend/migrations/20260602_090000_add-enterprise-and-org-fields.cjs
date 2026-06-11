const { ObjectId } = require("mongodb");

const DEFAULT_ORG_KEY = process.env.DEFAULT_ORG_KEY || "default";
const DEFAULT_ENTERPRISE_SLUG =
  process.env.DEFAULT_ENTERPRISE_SLUG || `${DEFAULT_ORG_KEY}-enterprise`;
const DEFAULT_ENTERPRISE_NAME = process.env.DEFAULT_ENTERPRISE_NAME || "Default Enterprise";

module.exports = {
  async up(db) {
    const enterprises = db.collection("enterprises");
    const organizations = db.collection("organizations");

    let enterprise = await enterprises.findOne({ slug: DEFAULT_ENTERPRISE_SLUG });
    if (!enterprise) {
      const now = new Date();
      enterprise = {
        _id: new ObjectId(),
        name: DEFAULT_ENTERPRISE_NAME,
        slug: DEFAULT_ENTERPRISE_SLUG,
        owners: [],
        admins: [],
        createdAt: now,
        updatedAt: now,
      };
      await enterprises.insertOne(enterprise);
    }

    await organizations.updateMany(
      {
        $or: [
          { enterpriseId: { $exists: false } },
          { enterpriseId: null },
          { enterpriseId: "" },
          { slug: { $exists: false } },
          { slug: null },
          { slug: "" },
          { allowAutoJoin: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            enterpriseId: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$enterpriseId", null] },
                    { $eq: ["$enterpriseId", ""] },
                    { $not: ["$enterpriseId"] },
                  ],
                },
                enterprise._id.toHexString(),
                "$enterpriseId",
              ],
            },
            slug: {
              $cond: [
                {
                  $or: [{ $eq: ["$slug", null] }, { $eq: ["$slug", ""] }, { $not: ["$slug"] }],
                },
                "$key",
                "$slug",
              ],
            },
            allowAutoJoin: { $ifNull: ["$allowAutoJoin", true] },
            updatedAt: new Date(),
          },
        },
      ]
    );

    const defaultOrg = await organizations.findOne({ key: DEFAULT_ORG_KEY });
    if (defaultOrg) {
      await organizations.updateOne(
        { _id: defaultOrg._id },
        {
          $set: {
            enterpriseId: defaultOrg.enterpriseId || enterprise._id.toHexString(),
            slug: defaultOrg.slug || defaultOrg.key,
            allowAutoJoin: defaultOrg.allowAutoJoin !== false,
            updatedAt: new Date(),
          },
        }
      );
    }
  },

  async down(db) {
    const enterprises = db.collection("enterprises");
    const organizations = db.collection("organizations");

    const enterprise = await enterprises.findOne({ slug: DEFAULT_ENTERPRISE_SLUG });

    await organizations.updateMany(
      {},
      {
        $unset: {
          enterpriseId: "",
          slug: "",
          allowAutoJoin: "",
        },
        $set: { updatedAt: new Date() },
      }
    );

    if (enterprise) {
      await enterprises.deleteOne({ _id: enterprise._id });
    }
  },
};
