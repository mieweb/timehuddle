import nodemailer from "nodemailer";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const transporter = createTransport();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "noreply@timecore.app",
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
}
