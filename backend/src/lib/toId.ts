import { ObjectId } from 'mongodb';

/**
 * Safely convert a string ID to ObjectId or leave as string.
 * Meteor users have random string IDs; Fastify users have 24-char hex IDs.
 */
export function toId(id: string): ObjectId | string {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : id;
}
