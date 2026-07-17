/**
 * Shared test setup — environment config.
 *
 * Tests hit the running Meteor wormhole REST endpoints (localhost:3101/api/*)
 * and create users via DDP (accounts.createUser method).
 *
 * Prerequisite: dedicated test Meteor backend running, pointed at an isolated
 * database — pm2 start ecosystem.config.cjs --only timehuddle-meteor-test.
 * Do not point this at the port-3100 dev instance: some tests (see
 * enterprises.test.ts) call `organizations.deleteMany({})` directly against
 * whatever database that instance is using.
 */

export const METEOR_URL = process.env.METEOR_URL ?? 'http://localhost:3101';
