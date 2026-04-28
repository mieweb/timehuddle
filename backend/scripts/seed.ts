import "dotenv/config";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

const SEED_USERS = [
  { name: "Alice Admin", email: "alice@example.com", password: "Password1!" },
  { name: "Bob Builder", email: "bob@example.com", password: "Password1!" },
  { name: "Carol Dev", email: "carol@example.com", password: "Password1!" },
];

async function seed() {
  await connectDB();

  for (const user of SEED_USERS) {
    try {
      await auth.api.signUpEmail({ body: user });
      console.log(`✓ Created: ${user.email}`);
    } catch (err: any) {
      // Better Auth throws when the email is already taken
      const message: string = err?.message ?? String(err);
      if (message.toLowerCase().includes("already") || message.toLowerCase().includes("exist")) {
        console.log(`- Skipped (exists): ${user.email}`);
      } else {
        console.error(`✗ Failed: ${user.email} —`, message);
      }
    }
  }

  await client.close();
  console.log("Done.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
