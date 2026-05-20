import { FastifyRequest, FastifyReply } from "fastify";
import fs from "fs";
import path from "path";
import {
  profileMediaDir,
  buildProfileMediaFilename,
  profileMediaUrl,
} from "../lib/profileMedia.js";
import { profilesCollection } from "../models/index.js";

/** Delete a profile media file identified by its stored URL (fire-and-forget). */
function unlinkProfileMedia(storedUrl: string | undefined | null): void {
  if (!storedUrl) return;
  const filename = storedUrl.split("/").pop();
  if (filename) fs.unlink(path.join(profileMediaDir(), filename), () => {});
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

    if (data.mimetype !== "image/png" && data.mimetype !== "image/jpeg") {
      return reply.status(400).send({ error: "Only PNG and JPEG images are allowed." });
    }

    const dir = profileMediaDir();
    fs.mkdirSync(dir, { recursive: true });

    const filename = buildProfileMediaFilename(userId, "avatar", data.mimetype);
    const filepath = path.join(dir, filename);

    // Delete old avatar file before saving the new one
    const existing = await profilesCollection().findOne({ userId, app: "timeharbor" as const });
    unlinkProfileMedia(existing?.avatarUrl);

    fs.writeFileSync(filepath, await data.toBuffer());

    const avatarUrl = profileMediaUrl(filename);

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
    unlinkProfileMedia(existing?.avatarUrl);

    await profilesCollection().findOneAndUpdate(
      { userId, app: "timeharbor" as const },
      { $unset: { avatarUrl: "" }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    reply.send({ ok: true });
  },

  async uploadBackground(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    const data = await (req as any).file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    if (data.mimetype !== "image/png" && data.mimetype !== "image/jpeg") {
      return reply.status(400).send({ error: "Only PNG and JPEG images are allowed." });
    }

    const dir = profileMediaDir();
    fs.mkdirSync(dir, { recursive: true });

    const filename = buildProfileMediaFilename(userId, "background", data.mimetype);
    const filepath = path.join(dir, filename);

    // Delete old background file before saving the new one
    const existing = await profilesCollection().findOne({ userId, app: "timeharbor" as const });
    unlinkProfileMedia(existing?.backgroundUrl);

    fs.writeFileSync(filepath, await data.toBuffer());

    const backgroundUrl = profileMediaUrl(filename);

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
        $set: { backgroundUrl, updatedAt: now },
      },
      { upsert: true, returnDocument: "after" }
    );

    reply.send({ backgroundUrl });
  },

  async deleteBackground(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;

    const existing = await profilesCollection().findOne({ userId, app: "timeharbor" as const });
    unlinkProfileMedia(existing?.backgroundUrl);

    await profilesCollection().findOneAndUpdate(
      { userId, app: "timeharbor" as const },
      { $unset: { backgroundUrl: "" }, $set: { updatedAt: new Date() } },
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
