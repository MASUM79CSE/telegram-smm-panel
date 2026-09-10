import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    });
  }

  return transporter;
}

interface SendMailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail({ to, subject, html }: SendMailParams): Promise<void> {
  const t = getTransporter();

  if (!t) {
    // Dev fallback: log instead of failing, so local dev doesn't require
    // SMTP. IMPORTANT: `html` (the full email body, including the actual
    // verification/reset link) is logged at `info` level so it survives
    // even if `LOG_LEVEL` is raised above `warn` in some environment —
    // this is the ONLY way local dev / the e2e suite (see
    // `e2e/helpers.ts#readLatestVerificationLink`, which greps this exact
    // log line's `html` field out of the server's raw stdout) can ever
    // complete an email-gated flow without real SMTP configured. Kept as
    // one structured object (not string concatenation) so the link
    // survives verbatim inside the emitted JSON in production mode.
    logger.info({ to, subject, html }, "[mail] SMTP not configured — logging email instead of sending it");
    return;
  }

  await t.sendMail({
    from: env.EMAIL_FROM || "SMM Panel <no-reply@example.com>",
    to,
    subject,
    html,
  });
}

export function verificationEmailHtml(link: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Verify your email</h2>
      <p>Click the button below to verify your email address. This link expires in 24 hours.</p>
      <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Verify Email</a>
      <p style="color:#666;font-size:12px;margin-top:24px;">If you didn't create an account, you can ignore this email.</p>
    </div>
  `;
}

export function passwordResetEmailHtml(link: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Reset your password</h2>
      <p>Click the button below to reset your password. This link expires in 1 hour and can only be used once.</p>
      <a href="${link}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Reset Password</a>
      <p style="color:#666;font-size:12px;margin-top:24px;">If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
    </div>
  `;
}
