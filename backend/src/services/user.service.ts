import { ObjectId } from "mongodb";
import { teamsCollection, usersCollection } from "../models/index.js";

// ─── Username policy ──────────────────────────────────────────────────────────

/**
 * Globally reserved handles that may not be claimed by any user.
 * Keep this list lowercase — incoming usernames are lowercased before comparison.
 */
const BLOCKED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "billing",
  "bot",
  "dashboard",
  "false",
  "help",
  "inbox",
  "me",
  "null",
  "root",
  "settings",
  "signup",
  "support",
  "system",
  "team",
  "teams",
  "timehuddle",
  "true",
  "undefined",
  "user",
  "users",
  "www",
]);

/** Regex that a valid username must fully match. */
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/;

export type UsernameValidationError =
  | "too-short"
  | "too-long"
  | "invalid-chars"
  | "blocked"
  | "taken";

export type UpdateProfileError =
  | "reports-to-self"
  | "reports-to-not-found"
  | "reports-to-not-teammate";

/** Validate username format and policy (does not check DB uniqueness). */
export function validateUsernameFormat(username: string): UsernameValidationError | null {
  if (username.length < 3) return "too-short";
  if (username.length > 30) return "too-long";
  if (!USERNAME_RE.test(username)) return "invalid-chars";
  if (BLOCKED_USERNAMES.has(username)) return "blocked";
  return null;
}

export class UserService {
  async findById(id: string) {
    return usersCollection().findOne({ _id: new ObjectId(id) });
  }

  async findByEmail(email: string) {
    return usersCollection().findOne({ email });
  }

  async findByUsername(username: string) {
    return usersCollection().findOne({ username: username.toLowerCase() });
  }

  async findManyByIds(ids: string[]) {
    const objectIds = ids
      .slice(0, 200)
      .filter((id) => /^[0-9a-f]{24}$/i.test(id))
      .map((id) => new ObjectId(id));
    if (objectIds.length === 0) return [];
    return usersCollection()
      .find({ _id: { $in: objectIds } })
      .toArray();
  }

  async updateProfile(
    id: string,
    data: {
      name?: string;
      image?: string | null;
      bio?: string;
      website?: string;
      reportsToUserId?: string | null;
    }
  ): Promise<Awaited<ReturnType<typeof this.findById>> | UpdateProfileError> {
    if (data.reportsToUserId !== undefined) {
      if (data.reportsToUserId === id) return "reports-to-self";

      if (data.reportsToUserId !== null) {
        const reportsToUser = await this.findById(data.reportsToUserId);
        if (!reportsToUser) return "reports-to-not-found";

        const sharedTeam = await teamsCollection().findOne({
          members: { $all: [id, data.reportsToUserId] },
          isPersonal: { $ne: true },
        });
        if (!sharedTeam) return "reports-to-not-teammate";
      }
    }

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) $set.name = data.name;
    if (data.image !== undefined) $set.image = data.image;
    if (data.bio !== undefined) $set.bio = data.bio;
    if (data.website !== undefined) $set.website = data.website;
    if (data.reportsToUserId !== undefined) $set.reportsToUserId = data.reportsToUserId;
    await usersCollection().updateOne({ _id: new ObjectId(id) }, { $set });
    return this.findById(id);
  }

  async list(limit = 50, skip = 0) {
    return usersCollection().find().skip(skip).limit(limit).toArray();
  }

  // ─── Username ───────────────────────────────────────────────────────────────

  /** Return true if the username is available (format-valid and not already taken). */
  async isUsernameAvailable(
    username: string
  ): Promise<{ available: boolean; reason?: UsernameValidationError }> {
    const formatError = validateUsernameFormat(username);
    if (formatError) return { available: false, reason: formatError };

    const existing = await usersCollection().findOne({ username });
    if (existing) return { available: false, reason: "taken" };

    return { available: true };
  }

  /**
   * Claim a canonical username for a user.
   * Returns the updated user document, or an error string.
   */
  async claimUsername(
    userId: string,
    username: string
  ): Promise<
    Awaited<ReturnType<typeof this.findById>> | UsernameValidationError | "already-claimed"
  > {
    const normalized = username.trim().toLowerCase();

    const formatError = validateUsernameFormat(normalized);
    if (formatError) return formatError;

    // Check current user — reject if they already have a username.
    const user = await this.findById(userId);
    if (user?.username) return "already-claimed";

    // Rely on the unique index to reject duplicates atomically.
    // Catch a MongoDB duplicate-key error (E11000) and surface it as "taken".
    try {
      await usersCollection().updateOne(
        { _id: new ObjectId(userId), username: { $eq: null } },
        { $set: { username: normalized, updatedAt: new Date() } }
      );
    } catch (err: unknown) {
      // MongoDB duplicate key error code
      if ((err as { code?: number }).code === 11000) return "taken";
      throw err;
    }

    return this.findById(userId);
  }
}

export const userService = new UserService();
