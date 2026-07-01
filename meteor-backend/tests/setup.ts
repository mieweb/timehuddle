/**
 * Shared test setup — environment config.
 *
 * Tests hit the running Meteor wormhole REST endpoints (localhost:3100/api/*)
 * and create users via DDP (accounts.createUser method).
 *
 * Prerequisite: Meteor backend running (pm2 start ecosystem.config.cjs or npm start)
 */

export const METEOR_URL = process.env.METEOR_URL ?? 'http://localhost:3100';
