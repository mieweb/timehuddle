import "dotenv/config";
import { ObjectId } from "mongodb";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";
import { teamsCollection, usersCollection } from "../src/models/index.js";

const SEED_USERS = [
  { name: "Alice Admin", email: "alice@example.com", password: "Password1!" },
  { name: "Bob Builder", email: "bob@example.com", password: "Password1!" },
  { name: "Carol Dev", email: "carol@example.com", password: "Password1!" },
  { name: "Dan Developer", email: "dan@example.com", password: "Password1!" },
  { name: "Eve Engineer", email: "eve@example.com", password: "Password1!" },
  { name: "Frank Finance", email: "frank@example.com", password: "Password1!" },
  { name: "Grace Ledger", email: "grace@example.com", password: "Password1!" },
  { name: "Hannah HR", email: "hannah@example.com", password: "Password1!" },
  { name: "Ian IT", email: "ian@example.com", password: "Password1!" },
  { name: "Jules Support", email: "jules@example.com", password: "Password1!" },
  { name: "Kira Product", email: "kira@example.com", password: "Password1!" },
  { name: "Liam Designer", email: "liam@example.com", password: "Password1!" },
  { name: "Maya Marketing", email: "maya@example.com", password: "Password1!" },
  { name: "Noah Ops", email: "noah@example.com", password: "Password1!" },
  { name: "Olivia Analyst", email: "olivia@example.com", password: "Password1!" },
];

// Keep exactly one seeded user unclaimed for username-claim flows.
const UNCLAIMED_USERNAME_EMAIL = "olivia@example.com";

const SEED_TEAMS = [
  {
    name: "Developers",
    description: "Frontend and backend engineers building TimeHuddle.",
    admins: ["alice@example.com", "carol@example.com"],
    members: [
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
      "dan@example.com",
      "eve@example.com",
      "ian@example.com",
    ],
  },
  {
    name: "Accounting",
    description: "Billing, payroll, and financial reporting.",
    admins: ["frank@example.com"],
    members: ["frank@example.com", "grace@example.com", "olivia@example.com"],
  },
  {
    name: "Product",
    description: "Product planning and roadmap prioritization.",
    admins: ["kira@example.com"],
    members: ["kira@example.com", "alice@example.com", "liam@example.com"],
  },
  {
    name: "Design",
    description: "UX research, visual design, and prototypes.",
    admins: ["liam@example.com"],
    members: ["liam@example.com", "kira@example.com", "maya@example.com"],
  },
  {
    name: "Support",
    description: "Customer support and escalation management.",
    admins: ["jules@example.com"],
    members: ["jules@example.com", "hannah@example.com", "noah@example.com"],
  },
  {
    name: "Operations",
    description: "Internal IT, onboarding, and environment operations.",
    admins: ["noah@example.com", "ian@example.com"],
    members: ["noah@example.com", "ian@example.com", "hannah@example.com", "maya@example.com"],
  },
];

function generateTeamCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

type TeamSeed = (typeof SEED_TEAMS)[number];

function emailsToIds(emails: string[], userIdsByEmail: Map<string, string>): string[] {
  return Array.from(
    new Set(
      emails.map((email) => userIdsByEmail.get(email)).filter((id): id is string => Boolean(id))
    )
  );
}

async function upsertSeedTeam(team: TeamSeed, userIdsByEmail: Map<string, string>) {
  const memberIds = emailsToIds(team.members, userIdsByEmail);
  const adminIds = emailsToIds(team.admins, userIdsByEmail).filter((id) => memberIds.includes(id));

  if (memberIds.length === 0) {
    console.log(`- Skipped team (no valid members): ${team.name}`);
    return;
  }

  const existing = await teamsCollection().findOne({ name: team.name, isPersonal: false });

  if (!existing) {
    await teamsCollection().insertOne({
      _id: new ObjectId(),
      name: team.name,
      description: team.description,
      members: memberIds,
      admins: adminIds,
      code: generateTeamCode(),
      isPersonal: false,
      createdAt: new Date(),
    });
    console.log(`✓ Created team: ${team.name}`);
    return;
  }

  await teamsCollection().updateOne(
    { _id: existing._id },
    {
      $set: {
        description: team.description,
        updatedAt: new Date(),
      },
      $addToSet: {
        members: { $each: memberIds },
        admins: { $each: adminIds },
      },
    }
  );
  console.log(`- Updated team: ${team.name}`);
}

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

  const users = await usersCollection()
    .find({ email: { $in: SEED_USERS.map((u) => u.email) } })
    .toArray();
  const userIdsByEmail = new Map(users.map((u) => [u.email, u._id.toString()]));

  // Assign deterministic usernames to all seeded users except one intentional unclaimed user.
  await usersCollection().bulkWrite(
    SEED_USERS.filter((u) => u.email !== UNCLAIMED_USERNAME_EMAIL).map((u) => ({
      updateOne: {
        filter: { email: u.email },
        update: { $set: { username: u.email.split("@")[0] } },
      },
    }))
  );

  // Explicitly keep one seeded user without a username.
  await usersCollection().updateOne(
    { email: UNCLAIMED_USERNAME_EMAIL },
    { $unset: { username: "" } }
  );

  for (const team of SEED_TEAMS) {
    await upsertSeedTeam(team, userIdsByEmail);
  }

  await client.close();
  console.log("Done.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
