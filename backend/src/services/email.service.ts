/**
 * Email service stub.
 * Currently logs to console. Replace with Resend / SES / SMTP when ready.
 */

interface ResetPasswordEmailParams {
  to: string;
  userName: string;
  resetUrl: string;
}

export async function sendResetPasswordEmail({
  to,
  userName,
  resetUrl,
}: ResetPasswordEmailParams): Promise<void> {
  // TODO: Wire up a real email provider (e.g. Resend, SES, Nodemailer)
  console.log("────────────────────────────────────────");
  console.log("📧  Password Reset Email (stub)");
  console.log(`    To:   ${to}`);
  console.log(`    Name: ${userName}`);
  console.log(`    URL:  ${resetUrl}`);
  console.log("────────────────────────────────────────");
}
