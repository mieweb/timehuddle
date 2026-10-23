/**
 * Pure rules for carrying an outside issue on a TimeHuddle ticket (#736).
 *
 * The first time someone acts on a bare Redmine issue (starts a timer, adds it
 * to My Board), the team's ticket carrying it is found, or created and linked.
 * One ticket per issue per team: a lock row per team and issue keeps two
 * clicks, or two teammates, from creating two.
 *
 * No Meteor imports, so this is unit-testable (tests/ticket-carry-core.test.ts).
 */

/**
 * How long a lock row may sit before another caller takes it over (a crash
 * mid-carry). Well above a carry's longest step: a Redmine read times out after
 * 8 seconds (`DEFAULT_TIMEOUT_MS` in redmine-client.js), so a live carry is
 * never taken over.
 */
export const CARRY_LOCK_STALE_MS = 30 * 1000;

/** How often, and how long, a caller waits for someone else's carry of the same issue. */
const LOCK_RETRY_MS = 150;
const LOCK_TRIES = 20;

/** The lock row's id: one per team and issue. */
export function carryLockId(teamId, issueId) {
  return `${teamId}:${issueId}`;
}

/** The new ticket's title: the issue's subject, or its number when it has none. */
export function carriedTitle(issue, issueId) {
  const subject = typeof issue?.subject === 'string' ? issue.subject.trim() : '';
  return subject || `Redmine issue #${issueId}`;
}

/**
 * Find the ticket carrying the issue, or read the issue and create one.
 * Returns `{ ticket, created }`.
 *
 * Finding comes first, so acting on an issue the team already carries needs no
 * call to Redmine.
 */
export async function findOrCarry({ findCarrier, readIssue, createCarrier }) {
  const existing = await findCarrier();
  if (existing) return { ticket: existing, created: false };
  const issue = await readIssue();
  return { ticket: await createCarrier(issue), created: true };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` holding lock `id` in `locks` (a MongoDB collection), and release it
 * after. A caller who finds the lock taken waits for it, then runs `fn` itself,
 * which by then finds the ticket the other caller created. A lock older than
 * `CARRY_LOCK_STALE_MS` is taken over. Throws an Error with `code: 'carry-busy'`
 * when the lock stays taken.
 */
export async function withCarryLock(locks, id, fn, { now = () => Date.now(), wait = sleep } = {}) {
  let takenAt = null;
  for (let attempt = 0; attempt < LOCK_TRIES && takenAt === null; attempt += 1) {
    const at = new Date(now());
    try {
      await locks.insertOne({ _id: id, takenAt: at });
      takenAt = at;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const takeover = await locks.updateOne(
        { _id: id, takenAt: { $lt: new Date(at.getTime() - CARRY_LOCK_STALE_MS) } },
        { $set: { takenAt: at } },
      );
      if (takeover.modifiedCount === 1) takenAt = at;
      else await wait(LOCK_RETRY_MS);
    }
  }
  if (takenAt === null) {
    throw Object.assign(new Error('This issue is being added already. Try again in a moment.'), {
      code: 'carry-busy',
    });
  }
  try {
    return await fn();
  } finally {
    // Only our own lock: one taken over after we went stale is someone else's.
    await locks.deleteOne({ _id: id, takenAt });
  }
}
