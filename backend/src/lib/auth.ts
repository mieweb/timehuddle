import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { bearer } from "better-auth/plugins";
import { oidcProvider } from "better-auth/plugins/oidc-provider";
import { client } from "./db.js";
import { sendEmail } from "./email.js";
import { teamService } from "../services/team.service.js";

// TimeHarbor is the only registered OAuth client (trusted — skips consent).
const TIMEHARBOR_CLIENT_ID = process.env.TIMEHARBOR_CLIENT_ID ?? "timeharbor";
const TIMEHARBOR_CLIENT_SECRET = process.env.TIMEHARBOR_CLIENT_SECRET ?? "";
const TIMEHARBOR_REDIRECT_URI =
  process.env.TIMEHARBOR_REDIRECT_URI ?? "http://localhost:3001/v1/timehuddle/oauth/callback";

export const auth = betterAuth({
  database: mongodbAdapter(client.db()),

  plugins: [
    // Emit `set-auth-token` response header on sign-in and accept
    // `Authorization: Bearer <token>` on all authenticated requests.
    // Required for Capacitor (custom-scheme WebViews where cookies are unreliable).
    bearer(),

    // OIDC provider — TimeHarbor connects via OAuth 2.0 Authorization Code flow.
    // Endpoints exposed under /api/auth/oauth2/* and /api/auth/.well-known/...
    oidcProvider({
      // Silence the deprecation warning — the replacement package (@better-auth/oauth-provider)
      // is not yet available as a stable release in our version.
      __skipDeprecationWarning: true,

      // Where to redirect unauthenticated users during the authorize flow.
      loginPage:
        process.env.TIMEHUDDLE_LOGIN_PAGE ??
        `${process.env.APP_URL ?? "http://localhost:3000"}/auth/sign-in`,

      // Secrets stored as plain text — SHA-256 hashing can be enabled in production.
      storeClientSecret: "plain",

      // TimeHarbor is a trusted first-party client: skip the consent screen.
      trustedClients: TIMEHARBOR_CLIENT_SECRET
        ? [
            {
              clientId: TIMEHARBOR_CLIENT_ID,
              clientSecret: TIMEHARBOR_CLIENT_SECRET,
              name: "TimeHarbor",
              type: "web",
              redirectUrls: [TIMEHARBOR_REDIRECT_URI],
              disabled: false,
              metadata: null,
              skipConsent: true,
            },
          ]
        : [],
    }),
  ],

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

  // GitHub OAuth social provider
  // Credentials are read from GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET env vars.
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },

  // username is claimed post-signup via a dedicated endpoint — stored on the user document.
  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false,
        unique: true,
        input: false,
      },
    },
  },

  // Bootstrap a personal workspace the first time a user account is created.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await teamService.ensurePersonalWorkspace(user.id);
          } catch (err) {
            // Non-fatal — the user can still sign in; personal org is idempotent.
            console.error("[auth] Failed to bootstrap personal workspace for", user.id, err);
          }
        },
      },
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
