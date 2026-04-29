import { ObjectId } from "mongodb";

/**
 * Tracks whether a user has saved their recovery key.
 *
 * Once marked as saved, the "Save Key" button is disabled in the UI
 * so the user cannot accidentally operate with a stale key after
 * key regeneration.
 */
export interface RecoveryKeyStatus {
  _id: ObjectId;
  /** Identity UUID of the user. */
  userId: string;
  /** Whether the user has saved their recovery key. */
  saved: boolean;
  /** When the key was saved. */
  savedAt: Date;
}
