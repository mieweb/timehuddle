/**
 * Email — port of backend/src/lib/email.ts.
 *
 * Thin nodemailer wrapper reading the same SMTP_* / EMAIL_FROM env the Fastify
 * backend uses, so transactional mail keeps working identically once a Meteor
 * consumer (M1+) needs it. No Meteor-specific types — a plain async function.
 */
import nodemailer from 'nodemailer';

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

/** Send a single HTML email. Mirrors backend sendEmail(). */
export async function sendEmail({ to, subject, html }) {
  const transporter = createTransport();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? 'noreply@timecore.app',
    to,
    subject,
    html,
  });
}
