import { usersCollection } from "../src/models/index.js";

const SEED_REPORTS_TO_EMAIL: Record<string, string | null> = {
  "alice@example.com": null,

  "carol@example.com": "alice@example.com",
  "bob@example.com": "carol@example.com",
  "dan@example.com": "carol@example.com",
  "eve@example.com": "carol@example.com",

  "kira@example.com": "alice@example.com",
  "liam@example.com": "kira@example.com",
  "maya@example.com": "liam@example.com",

  "frank@example.com": "alice@example.com",
  "grace@example.com": "frank@example.com",
  "olivia@example.com": "frank@example.com",

  "noah@example.com": "alice@example.com",
  "ian@example.com": "noah@example.com",
  "hannah@example.com": "noah@example.com",
  "jules@example.com": "noah@example.com",
};

export async function applySeedHierarchy(): Promise<void> {
  const allEmails = Array.from(
    new Set([
      ...Object.keys(SEED_REPORTS_TO_EMAIL),
      ...Object.values(SEED_REPORTS_TO_EMAIL).filter((email): email is string => Boolean(email)),
    ])
  );

  const users = await usersCollection()
    .find({ email: { $in: allEmails } }, { projection: { _id: 1, email: 1 } })
    .toArray();

  const userIdByEmail = new Map(users.map((user) => [user.email, user._id.toHexString()]));

  const operations = Object.entries(SEED_REPORTS_TO_EMAIL).map(([email, managerEmail]) => {
    const managerId = managerEmail ? (userIdByEmail.get(managerEmail) ?? null) : null;
    return {
      updateOne: {
        filter: { email },
        update: {
          $set: {
            reportsToUserId: managerId,
            updatedAt: new Date(),
          },
        },
      },
    };
  });

  if (operations.length === 0) {
    console.log("- No hierarchy operations generated");
    return;
  }

  await usersCollection().bulkWrite(operations);
  console.log(`✓ Applied reports-to hierarchy for ${operations.length} seeded users`);
}
