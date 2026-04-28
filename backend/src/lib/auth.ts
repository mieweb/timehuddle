import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { client } from "./db.js";
import { sendEmail } from "./email.js";

export const auth = betterAuth({
  database: mongodbAdapter(client.db()),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url, token }) => {
      const resetUrl =
        url ?? `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>If you did not request this, please ignore this email.</p>`,
      });
    },
  },

  secret: process.env.BETTER_AUTH_SECRET!,

  // Static baseURL — must always be the FRONTEND domain so that:
  //   1. OAuth redirect_uri points to the frontend (cookies stay same-origin)
  //   2. State cookies set during sign-in are on the same domain as the callback
  // In production: BETTER_AUTH_URL=https://timeharborappuat.os.mieweb.org
  // Locally: BETTER_AUTH_URL=http://localhost:8080 (the proxy)
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:8080",

  trustedOrigins: process.env.TRUSTED_ORIGINS ? process.env.TRUSTED_ORIGINS.split(",") : [],

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    },
  },
});
