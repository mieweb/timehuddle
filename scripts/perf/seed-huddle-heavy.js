// Seed a production-like heavy Huddle feed into a LOCAL database, for the
// before/after benchmark in bench-huddle.mjs. Never point this at production.
//
//   mongosh "mongodb://127.0.0.1:27017/timehuddle?replicaSet=rs0" scripts/perf/seed-huddle-heavy.js
//
// Recreates the "Perf Bench" team on every run: 72 posts over the last 30 days,
// 15 of them carrying a ~600 KB screenshot inlined as a base64 data: URL — the
// shape the Kerebron editor saved pasted images in before paste-to-upload
// (cca7b9da). Production's slow team measured 71 posts / ~12 MB.

/* eslint-disable @typescript-eslint/no-require-imports -- mongosh scripts have no ES imports */
const fs = require('fs');
const path = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */

const BENCH_EMAIL = process.env.BENCH_EMAIL || 'perfprobe@test.local';
const TEAM_NAME = 'Perf Bench';
const DAYS = 30;
const POSTS = 72;
const HEAVY_EVERY = 5; // every 5th post embeds the screenshot → 15 heavy posts

const screenshot = fs
  .readFileSync(path.resolve('tests/e2e/fixtures/large-screenshot.png'))
  .toString('base64');
const inlineImage = `![screenshot](data:image/png;base64,${screenshot})`;

const owner = db.users.findOne({ 'emails.address': BENCH_EMAIL });
if (!owner) throw new Error(`No local user ${BENCH_EMAIL} — sign up with it first`);
const others = db.users
  .find({ _id: { $ne: owner._id } }, { _id: 1 })
  .limit(3)
  .toArray()
  .map((u) => u._id);
const members = [owner._id, ...others];
const orgId =
  db.teams.findOne({ members: owner._id, isPersonal: true })?.orgId ??
  db.organizations.findOne({})?._id?.toString();

const old = db.teams.findOne({ name: TEAM_NAME, admins: owner._id });
if (old) {
  db.huddlePosts.deleteMany({ teamId: old._id.toString() });
  db.teams.deleteOne({ _id: old._id });
}

const teamId = new ObjectId();
db.teams.insertOne({
  _id: teamId,
  orgId,
  parentTeamId: null,
  name: TEAM_NAME,
  members,
  admins: [owner._id],
  code: 'PERFBNCH',
  isPersonal: false,
  createdAt: new Date(Date.now() - (DAYS + 5) * 86400000),
});

const posts = [];
for (let i = 0; i < POSTS; i++) {
  const daysAgo = Math.floor((i * DAYS) / POSTS);
  const createdAt = new Date(Date.now() - daysAgo * 86400000 - (i % 3) * 3600000);
  const heavy = i % HEAVY_EVERY === 0;
  const text =
    `## Update ${i + 1}\n\n` +
    `- Worked on item ${i + 1}: reviewed the change, ran the suite, wrote notes.\n` +
    `- Next: follow up on review comments.\n` +
    (heavy ? `\n${inlineImage}\n` : '');
  posts.push({
    _id: new ObjectId(),
    teamId: teamId.toString(),
    userId: members[i % members.length],
    content: { text, mentions: [] },
    attachments: [],
    likes: [],
    commentCount: 0,
    postDate: createdAt.toISOString().slice(0, 10),
    createdAt,
    updatedAt: createdAt,
  });
}
db.huddlePosts.insertMany(posts);

const bytes = posts.reduce((n, p) => n + p.content.text.length, 0);
print(
  `Seeded team ${teamId} "${TEAM_NAME}": ${posts.length} posts, ` +
    `${posts.filter((p) => p.content.text.includes('base64')).length} with inline images, ` +
    `${(bytes / 1048576).toFixed(1)} MB of post text`,
);
