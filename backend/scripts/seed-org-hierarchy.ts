import "dotenv/config";

import { client, connectDB } from "../src/lib/db.js";
import { applySeedHierarchy } from "./seed-hierarchy.js";

async function run() {
  await connectDB();
  await applySeedHierarchy();
  await client.close();
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
