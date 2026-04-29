import { ObjectId } from "mongodb";

/**
 * Encrypted op-log batch — an opaque blob the server cannot decrypt.
 *
 * The server stores and relays these between devices belonging to
 * the same user.  The `encryptedPayload` contains one or more
 * AES-256-GCM-encrypted op-log entries serialised as JSON.
 */
export interface EncryptedOpLogBatch {
  _id: ObjectId;
  /** User id used for scoping queries. */
  userId: string;
  /** Originating device identifier. */
  deviceId: string;
  /** HLC string of the last entry in the batch (cursor for paging). */
  hlc: string;
  /** Number of ops inside the blob (metadata only — server can't verify). */
  count: number;
  /**
   * The encrypted blob.  The server treats this as an opaque Binary.
   * Structure (once decrypted on the client):
   *   { iv: base64, ciphertext: base64 }
   */
  encryptedPayload: {
    iv: string;
    ciphertext: string;
  };
  createdAt: Date;
}
