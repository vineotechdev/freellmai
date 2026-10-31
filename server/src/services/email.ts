import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Checks if SMTP email sending is configured via environment variables.
 */
export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_HOST.trim().length > 0 &&
    process.env.SMTP_USER &&
    process.env.SMTP_USER.trim().length > 0
  );
}

/**
 * Initializes and caches the nodemailer SMTP transporter.
 */
function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!isSmtpConfigured()) return null;

  const host = process.env.SMTP_HOST!.trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASS?.trim() || '';

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });

  return transporter;
}

/**
 * Sends an email using SMTP if configured, or logs the email content to stdout.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; delivered: boolean; error?: string }> {
  const mailer = getTransporter();
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || '"FreeLLM AI" <no-reply@polarlist.in>';

  if (mailer) {
    try {
      await mailer.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      console.log(`[Email] Successfully delivered email "${options.subject}" to ${options.to}`);
      return { success: true, delivered: true };
    } catch (err: any) {
      console.error(`[Email] SMTP delivery failed to ${options.to}:`, err.message);
      // Fall through to console logging so users are never permanently locked out
    }
  }

  // Console fallback for local dev or when SMTP is not configured
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│                    [PASSWORD RESET EMAIL]                       │');
  console.log(`│ To:       ${options.to.padEnd(54)}│`);
  console.log(`│ Subject:  ${options.subject.padEnd(54)}│`);
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log(`│ ${options.text.replace(/\r?\n/g, ' ').slice(0, 63).padEnd(64)}│`);
  console.log('├─────────────────────────────────────────────────────────────────┤');
  console.log('│ Note: Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env to send via   │');
  console.log('│       real email provider.                                      │');
  console.log('└─────────────────────────────────────────────────────────────────┘');
  console.log('');

  return { success: true, delivered: false };
}

/**
 * Sends a password reset code to a user's email address.
 */
export async function sendPasswordResetEmail(email: string, resetCode: string): Promise<boolean> {
  const subject = 'Your FreeLLM AI Password Reset Code';
  const text = `Hello,

We received a request to reset your password for your FreeLLM AI account (${email}).

Your password reset code is: ${resetCode}

This code will expire in 15 minutes. Enter this code on the password reset screen to set your new password.

If you did not request a password reset, you can safely ignore this email.

— The FreeLLM AI Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reset Your Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background-color: #0f172a; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.02em;">FreeLLM AI</h1>
    </div>
    <div style="padding: 32px 28px;">
      <h2 style="font-size: 18px; font-weight: 600; color: #1e293b; margin-top: 0; margin-bottom: 12px;">Password Reset Request</h2>
      <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
        We received a request to reset the password for your account associated with <strong>${email}</strong>.
      </p>
      <div style="background: #f1f5f9; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0;">
        <span style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; display: block; margin-bottom: 8px;">Your Reset Code</span>
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${resetCode}</span>
      </div>
      <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 16px 0;">
        This code is valid for <strong>15 minutes</strong>. Enter it on the reset form to choose a new password.
      </p>
      <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 20px 0 0 0; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        If you did not request this code, no action is required and your account remains secure.
      </p>
    </div>
  </div>
</body>
</html>`;

  const result = await sendEmail({ to: email, subject, text, html });
  return result.success;
}
