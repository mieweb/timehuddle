import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";
import { mediaItemsCollection } from "../src/models/index.js";

const TEST_USER = {
  name: "Media Test User",
  email: "media-test-user@test.dev",
  password: "Password1!",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaUploadsDir = path.resolve(__dirname, "../uploads/media");
const thumbnailsDir = path.resolve(__dirname, "../uploads/thumbnails");
const videosDir = path.resolve(__dirname, "../data/videos");

let app: FastifyInstance;
let cookie: string;
let userId: string;

async function getSessionCookie(email: string, password: string): Promise<string> {
  const res = (await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  })) as Response;
  const rawCookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  return rawCookies.map((c) => c.split(";")[0].trim()).join("; ");
}

async function purgeUser(email: string) {
  const db = client.db();
  const user = await db.collection("user").findOne({ email });
  if (!user) return;
  const userId = String(user._id);
  await Promise.all([
    db.collection("mediaitems").deleteMany({ userId }),
    db.collection("account").deleteMany({ userId }),
    db.collection("session").deleteMany({ userId }),
    db.collection("user").deleteOne({ _id: user._id }),
  ]);
}

function buildMultipartBody(opts: {
  fieldName: string;
  filename: string;
  contentType: string;
  data: Buffer;
}): { boundary: string; body: Buffer } {
  const boundary = `----timehuddle-test-${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${opts.fieldName}"; filename="${opts.filename}"\r\n` +
      `Content-Type: ${opts.contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([head, opts.data, tail]) };
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  await purgeUser(TEST_USER.email);
  await auth.api.signUpEmail({ body: TEST_USER });

  const user = await client.db().collection("user").findOne({ email: TEST_USER.email });
  if (!user) throw new Error("Failed to create media test user");

  userId = user._id.toHexString();
  cookie = await getSessionCookie(TEST_USER.email, TEST_USER.password);
}, 20000);

afterAll(async () => {
  await mediaItemsCollection().deleteMany({ userId });
  await purgeUser(TEST_USER.email);
  await app.close();
});

describe("media routes", () => {
  it("clamps list limit to 100 items", async () => {
    await mediaItemsCollection().deleteMany({ userId });

    const docs = Array.from({ length: 120 }, (_, idx) => ({
      _id: new ObjectId(),
      userId,
      type: "image" as const,
      mimeType: "image/png",
      url: `/uploads/media/limit-${idx}.png`,
      filename: `limit-${idx}.png`,
      size: 100 + idx,
      uploadedAt: new Date(Date.now() - idx * 1000),
    }));

    await mediaItemsCollection().insertMany(docs);

    const res = await app.inject({
      method: "GET",
      url: "/v1/media?limit=9999",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(100);
  });

  it("rejects thumbnail uploads with unsupported mime type", async () => {
    const docId = new ObjectId();
    await mediaItemsCollection().insertOne({
      _id: docId,
      userId,
      type: "video",
      mimeType: "video/mp4",
      url: "http://localhost:4000/v1/video/test-video-id",
      videoid: "test-video-id",
      filename: "test-video.mp4",
      size: 1234,
      uploadedAt: new Date(),
    });

    const { boundary, body } = buildMultipartBody({
      fieldName: "file",
      filename: "thumb.txt",
      contentType: "text/plain",
      data: Buffer.from("not-an-image"),
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/media/${docId.toHexString()}/thumbnail`,
      headers: {
        cookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Unsupported thumbnail type");
  });

  it("deletes local files when media item is deleted", async () => {
    const imageName = `delete-test-${Date.now()}.png`;
    const thumbName = `delete-test-${Date.now()}.jpg`;
    const videoid = `delete-video-${Date.now()}`;

    const imagePath = path.join(mediaUploadsDir, imageName);
    const thumbPath = path.join(thumbnailsDir, thumbName);
    const videoPath = path.join(videosDir, videoid);

    await fs.mkdir(mediaUploadsDir, { recursive: true });
    await fs.mkdir(thumbnailsDir, { recursive: true });
    await fs.mkdir(videoPath, { recursive: true });

    await fs.writeFile(imagePath, Buffer.from("img"));
    await fs.writeFile(thumbPath, Buffer.from("thumb"));
    await fs.writeFile(path.join(videoPath, "video.mp4"), Buffer.from("video"));

    const docId = new ObjectId();
    await mediaItemsCollection().insertOne({
      _id: docId,
      userId,
      type: "video",
      mimeType: "video/mp4",
      url: `/uploads/media/${imageName}`,
      videoid,
      filename: "source.mp4",
      size: 9876,
      thumbnail: `/uploads/thumbnails/${thumbName}`,
      uploadedAt: new Date(),
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/media/${docId.toHexString()}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(await exists(imagePath)).toBe(false);
    expect(await exists(thumbPath)).toBe(false);
    expect(await exists(videoPath)).toBe(false);
  });
});
