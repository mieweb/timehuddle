/**
 * Prune orphaned profile media files from backend/uploads/profile/.
 *
 * A file is considered "used" if its basename appears as the last segment of
 * `avatarUrl` or `backgroundUrl` in any profile document in the `profiles`
 * collection.
 *
 * Usage:
 *   npx tsx scripts/prune-profile-media.ts [--dry-run]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB, client } from "../src/lib/db.js";
import { profilesCollection } from "../src/models/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(__dirname, "..", "uploads", "profile");
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!fs.existsSync(PROFILE_DIR)) {
    console.log(`Profile media directory does not exist: ${PROFILE_DIR}`);
    process.exit(0);
  }

  await connectDB();

  // Collect all referenced filenames from profiles (avatarUrl + backgroundUrl)
  const profiles = await profilesCollection()
    .find(
      {
        $or: [
          { avatarUrl: { $exists: true, $ne: null } },
          { backgroundUrl: { $exists: true, $ne: null } },
        ],
      },
      { projection: { avatarUrl: 1, backgroundUrl: 1 } }
    )
    .toArray();

  const referencedFilenames = new Set<string>();
  for (const p of profiles) {
    if (p.avatarUrl) referencedFilenames.add(path.basename(p.avatarUrl));
    if (p.backgroundUrl) referencedFilenames.add(path.basename(p.backgroundUrl));
  }

  const allFiles = fs.readdirSync(PROFILE_DIR).filter((f) => {
    return f !== ".gitkeep" && fs.statSync(path.join(PROFILE_DIR, f)).isFile();
  });

  const unused = allFiles.filter((f) => !referencedFilenames.has(f));
  const used = allFiles.length - unused.length;

  console.log(`Profile media directory : ${PROFILE_DIR}`);
  console.log(`Total files             : ${allFiles.length}`);
  console.log(`Referenced by DB        : ${used}`);
  console.log(`Unused (to prune)       : ${unused.length}`);

  if (unused.length === 0) {
    console.log("Nothing to remove.");
    await client.close();
    return;
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] Would delete:");
    for (const f of unused) console.log(`  ${f}`);
  } else {
    console.log("\nDeleting:");
    for (const f of unused) {
      fs.unlinkSync(path.join(PROFILE_DIR, f));
      console.log(`  deleted ${f}`);
    }
    console.log(`\nDone — removed ${unused.length} file(s).`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
