import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Must be hoisted before any import that pulls in auth.ts
vi.mock("../src/lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import type { MockedFunction } from "vitest";
import { sendEmail } from "../src/lib/email.js";
import { auth } from "../src/lib/auth.js";
import { connectDB, client } from "../src/lib/db.js";
import type { SendEmailOptions } from "../src/lib/email.js";

const mockSendEmail = sendEmail as MockedFunction<typeof sendEmail>;

const TEST_USER = {
  name: "Reset Test User",
  email: "vitest-reset@example.com",
  password: "OldPassword1!",
};

const NEW_PASSWORD = "NewPassword2@";

beforeAll(async () => {
  await connectDB();

  // Clean up any leftover data from previous runs
  const db = client.db();
  const existing = await db.collection("user").findOne({ email: TEST_USER.email });
  if (existing) {
    const userId = String(existing._id);
    await Promise.all([
      db.collection("account").deleteMany({ userId }),
      db.collection("session").deleteMany({ userId }),
      db.collection("verification").deleteMany({ identifier: TEST_USER.email }),
      db.collection("user").deleteOne({ _id: existing._id }),
    ]);
  }

  await auth.api.signUpEmail({ body: TEST_USER });
}, 15000);

afterAll(async () => {
  // Clean up the test user
  const db = client.db();
  const existing = await db.collection("user").findOne({ email: TEST_USER.email });
  if (existing) {
    const userId = String(existing._id);
    await Promise.all([
      db.collection("account").deleteMany({ userId }),
      db.collection("session").deleteMany({ userId }),
      db.collection("verification").deleteMany({ identifier: TEST_USER.email }),
      db.collection("user").deleteOne({ _id: existing._id }),
    ]);
  }
});

describe("sendResetPassword email callback", () => {
  it("calls sendEmail when forgetPassword is requested for a known user", async () => {
    mockSendEmail.mockClear();

    await auth.api.requestPasswordReset({
      body: { email: TEST_USER.email, redirectTo: "http://localhost:3000/reset-password" },
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();

    const [options] = mockSendEmail.mock.calls[0] as [SendEmailOptions];
    expect(options.to).toBe(TEST_USER.email);
    expect(options.subject).toBe("Reset your password");
    // better-auth embeds the reset link as: /api/auth/reset-password/TOKEN?callbackURL=...
    expect(options.html).toContain("/api/auth/reset-password/");
    expect(options.html).toContain("callbackURL=");
  });

  it("does not call sendEmail for an unknown email (no-op, no user enumeration leak)", async () => {
    mockSendEmail.mockClear();

    // better-auth silently no-ops for unknown emails to prevent user enumeration
    await auth.api.requestPasswordReset({
      body: { email: "unknown@example.com", redirectTo: "http://localhost:3000/reset-password" },
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("password reset flow", () => {
  it("resets the password using the token from the email link", async () => {
    mockSendEmail.mockClear();

    await auth.api.requestPasswordReset({
      body: { email: TEST_USER.email, redirectTo: "http://localhost:3000/reset-password" },
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();

    // Extract token from the better-auth reset URL path: /api/auth/reset-password/TOKEN
    const [options] = mockSendEmail.mock.calls[0] as [SendEmailOptions];
    const tokenMatch = options.html.match(/\/api\/auth\/reset-password\/([^?"&\s]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    // Perform the reset
    await auth.api.resetPassword({
      body: { token, newPassword: NEW_PASSWORD },
    });

    // Verify old password no longer works
    await expect(
      auth.api.signInEmail({ body: { email: TEST_USER.email, password: TEST_USER.password } })
    ).rejects.toThrow();

    // Verify new password works
    const signIn = await auth.api.signInEmail({
      body: { email: TEST_USER.email, password: NEW_PASSWORD },
      asResponse: true,
    });
    expect((signIn as Response).status).toBe(200);
  });

  it("rejects resetPassword with an invalid token", async () => {
    await expect(
      auth.api.resetPassword({ body: { token: "invalid-token-xyz", newPassword: "Any1!pass" } })
    ).rejects.toThrow();
  });
});
