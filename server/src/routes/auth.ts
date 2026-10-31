import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  userCount,
  createUser,
  verifyCredentials,
  createSession,
  validateSession,
  deleteSession,
  updateEmail,
  updatePassword,
  resetUserPassword,
  accountEmail,
  normalizeEmail,
  desktopSessionToken,
} from '../services/auth.js';
import { signJwtToken, getTenantApiKey, validatePolarQrCode } from '../services/tenant.js';
import { setupCodeMatches, clearSetupCode } from '../lib/setup-code.js';
import {
  generateResetCode,
  resetCodeMatches,
  clearResetCode,
  createPasswordResetCode,
  verifyPasswordResetCode,
} from '../lib/reset-code.js';

export const authRouter = Router();

const failedPasswordAttempts = new Map<number, number>();

// Multi-tenant registration schema (accepts Polar QR code or manual motherId & companyName)
const registerSchema = z.object({
  qrCode: z.string().trim().optional(),
  motherId: z.string().trim().optional(),
  companyName: z.string().trim().optional(),
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// Signing up is the one place the address has to look like an address.
const signupSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  qrCode: z.string().optional(),
  motherId: z.string().optional(),
  companyName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
  motherId: z.string().optional(),
});

// ── Brute-force throttle ──────────────────────────────────────────────────
// Simple in-memory per-email limiter. A local single-user tool doesn't need a
// distributed store; this just blunts online password guessing.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// Bound the map so a flood of distinct addresses cannot grow it without limit;
// expired buckets are pruned opportunistically, mirroring the per-IP limiter in
// middleware/rateLimit.ts.
const MAX_TRACKED_EMAILS = 10_000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

// The bucket key MUST be the same spelling verifyCredentials looks the user up
// by. Keying on `.toLowerCase()` alone while the lookup also trimmed meant
// " admin@example.com" authenticated against the admin row but landed in its
// own bucket, so every whitespace variant handed the guesser another five
// tries and the lockout never engaged.
function throttleKey(email: string): string {
  return normalizeEmail(email);
}
function isLockedOut(email: string): boolean {
  const a = attempts.get(throttleKey(email));
  return !!a && a.lockedUntil > Date.now();
}
// Seconds until the per-email lockout lifts (0 when not locked). The 429
// carries this as Retry-After so a client (or a scripted login retry loop)
// backs off for the ACTUAL remaining time instead of the worst-case 15 min.
function lockoutRetryAfterSec(email: string, now = Date.now()): number {
  const a = attempts.get(throttleKey(email));
  if (!a || a.lockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((a.lockedUntil - now) / 1000));
}
function recordFailure(email: string): void {
  const key = throttleKey(email);
  const a = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  a.count++;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockedUntil = Date.now() + LOCKOUT_MS;
    a.count = 0;
  }
  attempts.set(key, a);
  if (attempts.size > MAX_TRACKED_EMAILS) {
    const now = Date.now();
    for (const [tracked, state] of attempts) {
      if (tracked !== key && state.lockedUntil <= now) attempts.delete(tracked);
    }
  }
}
function clearFailures(email: string): void {
  attempts.delete(throttleKey(email));
}

function bearer(req: Request): string | undefined {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
}

function isLoopbackAddress(value: string | undefined): boolean {
  let addr = (value ?? '').trim();
  // Node reports IPv4 loopback over a dual-stack socket as "::ffff:127.0.0.1".
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  if (addr === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

// Is the caller connecting from the local machine? The socket peer address is
// the authority, NOT req.ip: forwarded headers are attacker-controlled, so
// letting one of them ASSERT locality would hand a remote caller the setup
// code exemption outright.
//
// But the socket peer alone is not sufficient either, because the reverse-proxy
// deployment this project documents (docs/en/proxy/OVERVIEW.md, and
// docs/en/troubleshooting/01-common-issues.md on TRUST_PROXY) puts Caddy/nginx/
// Traefik on the SAME host: every request then arrives from 127.0.0.1 and the
// socket test is true for the entire internet. So a forwarded hop can never
// grant locality, but it can withdraw it — exactly the treatment the Ollama
// open-loopback mode already applies in routes/ollama.ts:25-38.
function isLoopbackRemote(req: Request): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(',')[0];
  // A local reverse proxy is itself a loopback socket, but its first forwarded
  // hop may be remote. Refuse that request rather than silently widening the
  // no-code first-run path through the proxy.
  return !firstForwarded || isLoopbackAddress(firstForwarded);
}

// ── Desktop sign-in (#1399) ───────────────────────────────────────────────
// The desktop app's account is a hidden machine user with a random password
// nobody knows. Its own window gets sessions over IPC, but the same dashboard
// opened in a normal browser tab (the tray's "Open in browser", a bookmark,
// http://127.0.0.1:31415) used to land on a Sign In form nobody could pass.
// On a desktop install, a request from this machine gets the session the
// window would have got, so the form never shows.
//
// Guards, all required:
//  - FREEAPI_DESKTOP=1: only the desktop embedder sets it; web/Docker installs
//    keep their login.
//  - Loopback socket with no remote forwarded hop (isLoopbackRemote), so LAN
//    access mode and a local reverse proxy never hand out sessions.
//  - A localhost Host header: a DNS-rebinding page (evil.example resolving to
//    127.0.0.1) is same-origin to the browser but still sends its own name.
//  - Not cross-site: another site's page can fire a request at 127.0.0.1, and
//    Sec-Fetch-Site / Origin say so.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isCrossSite(req: Request): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null') {
    let originHost: string;
    try {
      originHost = new URL(origin).hostname.toLowerCase();
    } catch {
      return true;
    }
    if (!LOCAL_HOSTNAMES.has(originHost)) return true;
  }
  return false;
}

export function desktopSignInAllowed(req: Request): boolean {
  if (process.env.FREEAPI_DESKTOP !== '1') return false;
  if (!isLoopbackRemote(req)) return false;
  const host = hostnameOf(req.headers.host);
  if (!host || !LOCAL_HOSTNAMES.has(host)) return false;
  return !isCrossSite(req);
}

// Has the dashboard been set up yet, and is this caller authenticated?
// `desktop` tells the dashboard it can fetch a session instead of showing the
// sign-in form.
authRouter.get('/status', (req: Request, res: Response) => {
  const session = validateSession(bearer(req));
  const apiKey = session ? getTenantApiKey(session.motherId, session.companyName) : null;
  res.json({
    needsSetup: userCount() === 0,
    authenticated: !!session,
    email: session?.email ?? null,
    motherId: session?.motherId ?? null,
    companyName: session?.companyName ?? null,
    apiKey,
    desktop: desktopSignInAllowed(req),
  });
});

authRouter.post('/desktop-session', (req: Request, res: Response) => {
  if (!desktopSignInAllowed(req)) {
    res.status(403).json({ error: { message: 'Desktop sign-in is only available on this computer.', type: 'desktop_signin_forbidden' } });
    return;
  }
  res.json({ token: desktopSessionToken() });
});

// Validate PolarList QR / Scan code via internal call to Polar backend
authRouter.get('/validate-qr', async (req: Request, res: Response) => {
  const code = String(req.query.code || req.query.qrCode || '');
  const result = await validatePolarQrCode(code);
  res.json(result);
});

authRouter.post('/validate-qr', async (req: Request, res: Response) => {
  const code = String(req.body?.code || req.body?.qrCode || '');
  const result = await validatePolarQrCode(code);
  res.json(result);
});

// Multi-tenant registration: creates user with Polar QR code or mother_id & company_name
authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  let motherId = parsed.data.motherId ? parsed.data.motherId.trim() : '';
  let companyName = parsed.data.companyName ? parsed.data.companyName.trim() : '';
  const qrCodeInput = parsed.data.qrCode ? parsed.data.qrCode.trim() : '';

  // If QR code is provided, validate internally against Polar backend
  if (qrCodeInput) {
    const qrResult = await validatePolarQrCode(qrCodeInput);
    if (!qrResult.valid || !qrResult.motherId) {
      res.status(400).json({
        error: {
          message: qrResult.message || 'Invalid PolarList scan code. Please check with your administrator.',
          type: 'invalid_qr_code',
        },
      });
      return;
    }
    motherId = String(qrResult.motherId);
    companyName = qrResult.companyName || companyName || `Company ${motherId}`;
  }

  if (!motherId || !companyName) {
    res.status(400).json({
      error: {
        message: 'Polar QR code or Scan Key is required to register your company account.',
        type: 'missing_tenant_info',
      },
    });
    return;
  }

  try {
    const user = createUser({
      motherId,
      companyName,
      qrCode: qrCodeInput || undefined,
      email: parsed.data.email,
      password: parsed.data.password,
    });
    clearSetupCode();
    createSession(user.userId);
    const token = signJwtToken({
      userId: user.userId,
      email: user.email,
      motherId: user.motherId,
      companyName: user.companyName,
    });
    const apiKey = getTenantApiKey(user.motherId, user.companyName);
    res.status(201).json({
      token,
      email: user.email,
      motherId: user.motherId,
      companyName: user.companyName,
      apiKey,
    });
  } catch (err: any) {
    res.status(400).json({ error: { message: err.message || 'Registration failed' } });
  }
});

// First-run account creation or setup.
authRouter.post('/setup', async (req: Request, res: Response) => {
  if (userCount() > 0) {
    // In multi-tenant mode, forward to registration if users already exist
    const parsedReg = registerSchema.safeParse(req.body);
    if (parsedReg.success) {
      let motherId = parsedReg.data.motherId ? parsedReg.data.motherId.trim() : '';
      let companyName = parsedReg.data.companyName ? parsedReg.data.companyName.trim() : '';
      const qrCodeInput = parsedReg.data.qrCode ? parsedReg.data.qrCode.trim() : '';

      if (qrCodeInput) {
        const qrResult = await validatePolarQrCode(qrCodeInput);
        if (qrResult.valid && qrResult.motherId) {
          motherId = String(qrResult.motherId);
          companyName = qrResult.companyName || companyName || `Company ${motherId}`;
        }
      }

      if (motherId && companyName) {
        try {
          const user = createUser({
            motherId,
            companyName,
            qrCode: qrCodeInput || undefined,
            email: parsedReg.data.email,
            password: parsedReg.data.password,
          });
          const sessionToken = createSession(user.userId);
          const jwtToken = signJwtToken({
            userId: user.userId,
            email: user.email,
            motherId: user.motherId,
            companyName: user.companyName,
          });
          const apiKey = getTenantApiKey(user.motherId, user.companyName);
          res.status(201).json({
            token: sessionToken,
            jwtToken,
            email: user.email,
            motherId: user.motherId,
            companyName: user.companyName,
            apiKey,
          });
          return;
        } catch (err: any) {
          res.status(400).json({ error: { message: err.message || 'Registration failed' } });
          return;
        }
      }
    }
    clearSetupCode();
    res.status(409).json({ error: { message: 'Setup already completed. Use login or register instead.', type: 'setup_complete' } });
    return;
  }

  if (!isLoopbackRemote(req) && !setupCodeMatches((req.body ?? {}).setupCode)) {
    res.status(403).json({
      error: {
        message: 'A setup code is required to create the first account from a remote device. ' +
          'Check the server logs for the code, or open the dashboard from a browser on the machine running FreeLLMAPI.',
        type: 'setup_code_required',
      },
    });
    return;
  }

  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const user = createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    motherId: parsed.data.motherId,
    companyName: parsed.data.companyName,
  });
  clearSetupCode();
  const sessionToken = createSession(user.userId);
  const jwtToken = signJwtToken({
    userId: user.userId,
    email: user.email,
    motherId: user.motherId,
    companyName: user.companyName,
  });
  const apiKey = getTenantApiKey(user.motherId, user.companyName);
  res.status(201).json({
    token: sessionToken,
    jwtToken,
    email: user.email,
    motherId: user.motherId,
    companyName: user.companyName,
    apiKey,
  });
});

authRouter.post('/login', (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const { email, password, motherId } = parsed.data;

  if (isLockedOut(email)) {
    res.setHeader('Retry-After', String(lockoutRetryAfterSec(email)));
    res.status(429).json({ error: { message: 'Too many attempts. Wait 15 minutes or restart the app.', type: 'rate_limit_error' } });
    return;
  }

  const user = verifyCredentials(email, password, motherId);
  if (!user) {
    recordFailure(email);
    res.status(401).json({ error: { message: 'Invalid email or password', type: 'authentication_error' } });
    return;
  }

  clearFailures(email);
  const sessionToken = createSession(user.userId);
  const jwtToken = signJwtToken({
    userId: user.userId,
    email: user.email,
    motherId: user.motherId,
    companyName: user.companyName,
  });
  const apiKey = getTenantApiKey(user.motherId, user.companyName);
  res.json({
    token: sessionToken,
    jwtToken,
    email: user.email,
    motherId: user.motherId,
    companyName: user.companyName,
    apiKey,
  });
});

authRouter.post('/logout', (req: Request, res: Response) => {
  deleteSession(bearer(req));
  res.json({ success: true });
});

authRouter.get('/me', (req: Request, res: Response) => {
  const session = validateSession(bearer(req));
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  const apiKey = getTenantApiKey(session.motherId, session.companyName);
  res.json({
    userId: session.userId,
    email: session.email,
    motherId: session.motherId,
    companyName: session.companyName,
    apiKey,
  });
});

// Change email (requires active session + current password)
const changeEmailSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newEmail: z.string().email('A valid email is required'),
});

authRouter.post('/change-email', (req: Request, res: Response) => {
  const session = validateSession(bearer(req));
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  const parsed = changeEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const ok = updateEmail(session.userId, parsed.data.currentPassword, parsed.data.newEmail);
    if (!ok) {
      const attempts = (failedPasswordAttempts.get(session.userId) || 0) + 1;
      if (attempts >= 3) {
        deleteSession(bearer(req));
        failedPasswordAttempts.delete(session.userId);
        res.status(401).json({ error: { message: 'Too many incorrect attempts. You have been signed out.', type: 'authentication_error' } });
        return;
      }
      failedPasswordAttempts.set(session.userId, attempts);
      res.status(403).json({ error: { message: 'Current password is incorrect', type: 'invalid_password' } });
      return;
    }
    failedPasswordAttempts.delete(session.userId);
    res.json({ success: true, email: parsed.data.newEmail.trim().toLowerCase() });
  } catch (err: any) {
    if (err.code === 'email_taken') {
      res.status(409).json({ error: { message: err.message, type: 'email_taken' } });
    } else {
      throw err;
    }
  }
});

// Change password (requires active session + current password)
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post('/change-password', (req: Request, res: Response) => {
  const session = validateSession(bearer(req));
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const ok = updatePassword(session.userId, parsed.data.currentPassword, parsed.data.newPassword);
  if (!ok) {
    const attempts = (failedPasswordAttempts.get(session.userId) || 0) + 1;
    if (attempts >= 3) {
      deleteSession(bearer(req));
      failedPasswordAttempts.delete(session.userId);
      res.status(401).json({ error: { message: 'Too many incorrect attempts. You have been signed out.', type: 'authentication_error' } });
      return;
    }
    failedPasswordAttempts.set(session.userId, attempts);
    res.status(403).json({ error: { message: 'Current password is incorrect', type: 'invalid_password' } });
    return;
  }
  failedPasswordAttempts.delete(session.userId);
  res.json({ success: true });
});

// Forgot password: mint a unique per-user reset code and dispatch to user email
const RESET_CODE_MIN_INTERVAL_MS = 10_000;
let lastResetCodeAt = 0;

authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  const emailInput = req.body?.email ? String(req.body.email).trim() : '';

  if (emailInput) {
    const normalized = normalizeEmail(emailInput);
    const db = getDb();
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalized);

    // If user exists, create a unique reset code and send to their email
    if (user) {
      const result = await createPasswordResetCode(normalized);
      if (!result.success) {
        res.status(429).json({
          error: {
            message: result.message || 'Please wait before requesting another code.',
            type: 'rate_limit_error',
          },
        });
        return;
      }
    } else {
      // Small artificial delay to prevent email enumeration timing attacks
      await new Promise(r => setTimeout(r, 250));
    }

    res.json({
      success: true,
      email: normalized,
      message: 'Password reset code has been sent to your email.',
    });
    return;
  }

  // Fallback for single-user mode (legacy requests with no email body)
  if (userCount() === 0) {
    res.json({ success: true });
    return;
  }
  const now = Date.now();
  if (now - lastResetCodeAt < RESET_CODE_MIN_INTERVAL_MS) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((RESET_CODE_MIN_INTERVAL_MS - (now - lastResetCodeAt)) / 1000))));
    res.status(429).json({ error: { message: 'Too many reset-code requests. Try again later.', type: 'rate_limit_error' } });
    return;
  }
  lastResetCodeAt = now;
  const legacyEmail = accountEmail();
  generateResetCode(legacyEmail);
  if (legacyEmail) {
    void createPasswordResetCode(legacyEmail);
  }
  res.json({ success: true });
});

// Reset password: accept the code + user email + new password
const resetPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address').optional(),
  resetCode: z.string().min(1, 'Reset code is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { email, resetCode, newPassword } = parsed.data;

  // 1. If email is provided, verify against the unique per-user reset code
  if (email && email.trim()) {
    const verification = await verifyPasswordResetCode(email, resetCode);
    if (!verification.valid) {
      res.status(403).json({
        error: {
          message: verification.error || 'Invalid or expired reset code',
          type: 'authentication_error',
        },
      });
      return;
    }

    const user = resetUserPassword(newPassword, email);
    if (!user) {
      res.status(404).json({ error: { message: 'No account found for this email address', type: 'not_found' } });
      return;
    }

    const token = createSession(user.userId);
    const jwtToken = signJwtToken({
      userId: user.userId,
      email: user.email,
      motherId: user.motherId,
      companyName: user.companyName,
    });
    const tenantApiKey = getTenantApiKey(user.motherId, user.companyName);

    res.json({
      success: true,
      token,
      jwtToken,
      apiKey: tenantApiKey,
      email: user.email,
      motherId: user.motherId,
      companyName: user.companyName,
    });
    return;
  }

  // 2. Legacy fallback if no email was passed
  if (!resetCodeMatches(resetCode)) {
    res.status(403).json({ error: { message: 'Reset code is incorrect or has expired. Request a new one.', type: 'invalid_reset_code' } });
    return;
  }
  const user = resetUserPassword(newPassword);
  if (!user) {
    res.status(404).json({ error: { message: 'No account found', type: 'not_found' } });
    return;
  }
  clearResetCode();
  const token = createSession(user.userId);
  res.json({ success: true, token, email: user.email });
});
