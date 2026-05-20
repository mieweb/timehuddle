/**
 * profileMedia — helpers for profile media file naming and URL parsing.
 *
 * All profile images (avatar, background, …) live in one directory:
 *   backend/uploads/profile/
 *
 * Filename format:
 *   {userId}-{8-byte hex}_{type}.{ext}
 *   e.g. "abc123-deadbeef01020304_avatar.png"
 *
 * URL format (served by fastify-static):
 *   /uploads/profile/{filename}
 */

import { fileURLToPath } from "url";
import path from "path";
import crypto from "crypto";

export type ProfileMediaType = "avatar" | "background";

/** Absolute path to the shared profile-media storage directory. */
export function profileMediaDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, "..", "..", "uploads", "profile");
}

/** Build a new unique filename for a profile media upload. */
export function buildProfileMediaFilename(
  userId: string,
  type: ProfileMediaType,
  mimeType: "image/png" | "image/jpeg"
): string {
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const hex = crypto.randomBytes(8).toString("hex");
  return `${userId}-${hex}_${type}.${ext}`;
}

/** Convert a filename to its public URL path. */
export function profileMediaUrl(filename: string): string {
  return `/uploads/profile/${filename}`;
}

/**
 * Parse a stored URL or filename back into its parts.
 * Returns null if the string doesn't match the expected scheme.
 */
export function parseProfileMediaUrl(urlOrFilename: string): {
  userId: string;
  type: ProfileMediaType;
  ext: string;
  filename: string;
} | null {
  const filename = urlOrFilename.split("/").pop() ?? "";
  // Pattern: {userId}-{hex}_{type}.{ext}
  const match = filename.match(/^(.+)-[0-9a-f]{16}_(avatar|background)\.(png|jpg)$/);
  if (!match) return null;
  return {
    userId: match[1],
    type: match[2] as ProfileMediaType,
    ext: match[3],
    filename,
  };
}
