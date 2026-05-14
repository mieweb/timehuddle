import { createHash, randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { personalAccessTokensCollection } from "../models/index.js";
import { emitActivity } from "./activity.service.js";

const TOKEN_PREFIX = "th_pat_";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export const patService = {
  async createToken(
    userId: string,
    name: string,
    actor: { id: string; name: string; avatar?: string }
  ) {
    const rawToken = TOKEN_PREFIX + randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const tokenId = new ObjectId();

    await personalAccessTokensCollection().insertOne({
      _id: tokenId,
      userId,
      tokenHash,
      name,
      createdAt: new Date(),
    });

    void emitActivity({
      userId,
      actor,
      type: "pat.created",
      payload: { tokenId: tokenId.toHexString(), name },
    });

    return { rawToken };
  },

  async listTokens(userId: string) {
    return personalAccessTokensCollection()
      .find({ userId }, { projection: { tokenHash: 0, userId: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
  },

  async revokeToken(
    userId: string,
    tokenId: string,
    actor: { id: string; name: string; avatar?: string }
  ) {
    if (!ObjectId.isValid(tokenId)) return false;

    const result = await personalAccessTokensCollection().deleteOne({
      _id: new ObjectId(tokenId),
      userId,
    });

    if (result.deletedCount === 1) {
      void emitActivity({
        userId,
        actor,
        type: "pat.revoked",
        payload: { tokenId },
      });
      return true;
    }
    return false;
  },

  async validateToken(rawToken: string): Promise<string | null> {
    const tokenHash = hashToken(rawToken);
    const pat = await personalAccessTokensCollection().findOneAndUpdate(
      { tokenHash },
      { $set: { lastUsedAt: new Date() } },
      { returnDocument: "after" }
    );
    return pat?.userId ?? null;
  },
};
