/**
 * Shared test setup — environment config.
 *
 * Tests hit the running Meteor wormhole REST endpoints (localhost:3100/api/*)
 * and use Fastify's auth endpoints (localhost:4000) for user creation + JWT.
 *
 * Prerequisite: docker-compose up (Meteor + Fastify + MongoDB all running).
 */

export const METEOR_URL = process.env.METEOR_URL ?? 'http://localhost:3100';
export const FASTIFY_URL = process.env.FASTIFY_URL ?? 'http://localhost:4000';
