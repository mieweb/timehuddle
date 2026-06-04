/**
 * Migration: rename organization `key` field to `slug`
 *
 * 1. For any organization doc that has no `slug`, copy `key` → `slug`.
 * 2. Remove the legacy `key` field from all organization docs.
 */
module.exports = {
  async up(db) {
    // Backfill slug from key for any doc that has key but no slug
    await db
      .collection("organizations")
      .updateMany({ key: { $exists: true }, slug: { $exists: false } }, [
        { $set: { slug: "$key" } },
      ]);

    // Remove the legacy key field from all docs
    await db
      .collection("organizations")
      .updateMany({ key: { $exists: true } }, { $unset: { key: "" } });
  },

  async down(db) {
    // Restore key from slug for all docs (best-effort rollback)
    await db
      .collection("organizations")
      .updateMany({ slug: { $exists: true } }, [{ $set: { key: "$slug" } }]);
  },
};
