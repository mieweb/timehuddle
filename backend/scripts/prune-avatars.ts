/**
 * Prune unused avatar files from backend/data/avatars/.
 *
 * An avatar file is considered "used" if its path appears as the `avatarUrl`
 * in any profile document in the `profiles` collection.
 *
 * Usage:
 *   npx tsx backend/scripts/prune-avatars.ts [--dry-run]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB, client } from "../src/lib/db.js";
import { profilesCollection } from "../src/models/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVATARS_DIR = path.resolve(__dirname, "..", "data", "avatars");
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!fs.existsSync(AVATARS_DIR)) {
    console.log(`Avatar directory does not exist: ${AVATARS_DIR}`);
    process.exit(0);
  }

  await connectDB();

  // Collect all avatarUrl values stored in profiles
  const profiles = await profilesCollection()
    .find({ avatarUrl: { $exists: true, $ne: null } }, { projection: { avatarUrl: 1 } })
    .toArray();

  const referencedFilenames = new Set<string>();
  for (const p of profiles) {
    if (p.avatarUrl) {
      // avatarUrl is stored as e.g. /uploads/avatars/abc123.jpg
      referencedFilenames.add(path.basename(p.avatarUrl));
    }
  }

  const allFiles = fs.readdirSync(AVATARS_DIR).filter((f) => {
    const stat = fs.statSync(path.join(AVATARS_DIR, f));
    return stat.isFile();
  });

  const unused = allFiles.filter((f) => !referencedFilenames.has(f));
  const used = allFiles.length - unused.length;

  console.log(`Avatar directory : ${AVATARS_DIR}`);
  console.log(`Total files      : ${allFiles.length}`);
  console.log(`Referenced by DB : ${used}`);
  console.log(`Unused (to prune): ${unused.length}`);

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
      fs.unlinkSync(path.join(AVATARS_DIR, f));
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
