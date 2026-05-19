import { FastifyRequest, FastifyReply } from "fastify";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { profilesCollection } from "../models/index.js";

function avatarStorageDir() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, "..", "..", "data", "avatars");
}

export const profileController = {
  async getProfile(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();

    const result = await profilesCollection().findOneAndUpdate(
      { userId, app: "timeharbor" as const },
      {
        $setOnInsert: {
          userId,
          app: "timeharbor" as const,
          displayName: req.user!.name,
          status: "online" as const,
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true, returnDocument: "after" }
    );

    reply.send({ profile: result });
  },

  async updateProfile(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as {
      displayName?: string;
      githubUrl?: string;
      linkedinUrl?: string;
      redmineUrl?: string;
    };

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName !== undefined) $set.displayName = body.displayName;
    if (body.githubUrl !== undefined) $set.githubUrl = body.githubUrl;
    if (body.linkedinUrl !== undefined) $set.linkedinUrl = body.linkedinUrl;
    if (body.redmineUrl !== undefined) $set.redmineUrl = body.redmineUrl;

    const result = await profilesCollection().findOneAndUpdate(
      { userId, app: "timeharbor" as const },
      { $set },
      { returnDocument: "after" }
    );

    if (!result) {
      return reply.status(404).send({ error: "Profile not found" });
    }

    reply.send({ profile: result });
  },

  async uploadAvatar(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    const data = await (req as any).file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    // Allow PNG and JPEG files
    if (data.mimetype !== "image/png" && data.mimetype !== "image/jpeg") {
      return reply.status(400).send({ error: "Only PNG and JPEG images are allowed." });
    }

    const uploadsDir = avatarStorageDir();
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Use correct extension
    const ext = data.mimetype === "image/png" ? "png" : "jpg";
    const filename = `${userId}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const filepath = path.join(uploadsDir, filename);

    // Delete old avatar file if exists
    const existing = await profilesCollection().findOne({ userId, app: "timeharbor" as const });
    if (existing?.avatarUrl) {
      const oldFile = existing.avatarUrl.split("/").pop();
      if (oldFile) {
        const oldPath = path.join(uploadsDir, oldFile);
        fs.unlink(oldPath, () => {});
      }
    }

    // Save file to disk
    const buffer = await data.toBuffer();
    fs.writeFileSync(filepath, buffer);

    const avatarUrl = `/uploads/avatars/${filename}`;

    await profilesCollection().findOneAndUpdate(
      { userId, app: "timeharbor" as const },
      {
        $setOnInsert: {
          userId,
          app: "timeharbor" as const,
          displayName: req.user!.name,
          status: "online" as const,
          createdAt: now,
        },
        $set: { avatarUrl, updatedAt: now },
      },
      { upsert: true, returnDocument: "after" }
    );

    reply.send({ avatarUrl });
  },

  async deleteAvatar(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;

    const existing = await profilesCollection().findOne({ userId, app: "timeharbor" as const });
    if (existing?.avatarUrl) {
      const uploadsDir = avatarStorageDir();
      const oldFile = existing.avatarUrl.split("/").pop();
      if (oldFile) {
        const oldPath = path.join(uploadsDir, oldFile);
        fs.unlink(oldPath, () => {});
      }
    }

    await profilesCollection().findOneAndUpdate(
      { userId, app: "timeharbor" as const },
      { $unset: { avatarUrl: "" }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    reply.send({ ok: true });
  },

  async registerDevice(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const { fcmToken, fcmPlatform } = req.body as {
      fcmToken: string;
      fcmPlatform: "ios" | "android";
    };

    await profilesCollection().updateOne(
      { userId, app: "timeharbor" as const },
      {
        $set: {
          fcmToken,
          fcmPlatform,
          fcmUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    reply.send({ ok: true });
  },
};
