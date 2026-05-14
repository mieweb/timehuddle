import { createHash, randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { personalAccessTokensCollection } from "../models/index.js";

const TOKEN_PREFIX = "th_pat_";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export const patService = {
  async createToken(userId: string, name: string) {
    const rawToken = TOKEN_PREFIX + randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    await personalAccessTokensCollection().insertOne({
      _id: new ObjectId(),
      userId,
      tokenHash,
      name,
      createdAt: new Date(),
    });

    return { rawToken };
  },

  async listTokens(userId: string) {
    return personalAccessTokensCollection()
      .find({ userId }, { projection: { tokenHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
  },

  async revokeToken(userId: string, tokenId: string) {
    const result = await personalAccessTokensCollection().deleteOne({
      _id: new ObjectId(tokenId),
      userId,
    });
    return result.deletedCount === 1;
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
