import { createHash } from "crypto";
import { getDB } from "./db.js";
import { usersCollection } from "../models/index.js";
import type { AppUser } from "../middleware/require-auth.js";

export async function verifyWsToken(token: string | undefined): Promise<AppUser | null> {
  if (!token) return null;

  // Meteor resume token — SHA256+base64 hash lookup
  const hashedToken = createHash("sha256").update(token).digest("base64");
  const db = getDB();
  const meteorUser = await db.collection("users").findOne({
    "services.resume.loginTokens.hashedToken": hashedToken,
  });
  if (meteorUser) {
    const email = meteorUser.emails?.[0]?.address ?? "";
    const fastifyUser = await usersCollection().findOne({ email: email.toLowerCase() });
    if (fastifyUser) {
      return {
        id: fastifyUser._id.toString(),
        name: fastifyUser.name,
        email: fastifyUser.email,
        image: fastifyUser.image,
      };
    }
    return {
      id: meteorUser._id.toString(),
      name: meteorUser.profile?.name ?? email,
      email,
      image: null,
    };
  }

  // Better-auth session token fallback
  const { auth } = await import("./auth.js");
  const session = await auth.api.getSession({
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });
  if (session?.user) return session.user as AppUser;

  return null;
}
