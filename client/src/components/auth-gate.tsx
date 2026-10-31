import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, QrCode, CheckCircle2, Building2, AlertCircle, Mail, KeyRound, ArrowLeft } from 'lucide-react'
import { apiFetch, setToken, UNAUTHORIZED_EVENT, type ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { isEmail } from '@/lib/validate'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'
import { LegalModal } from '@/components/legal-modal'

// Matches the server rule (routes/auth.ts zod schema).
const PASSWORD_MIN = 8

// Inside the desktop shell the dashboard runs as a hidden machine account with
// a random password nobody knows (desktop/src/server-host.ts). There are no
// credentials to type, so the gate never shows a login form there: when the
// seeded session is gone (expired after a month of uptime, or cleared by a
// 401) it asks the shell for a fresh one through the preload bridge.
type DesktopWindow = Window & {
  __FREEAPI_DESKTOP__?: boolean
  __FREEAPI_SESSION__?: () => Promise<string>
}
function desktopSessionBridge(): (() => Promise<string>) | null {
  if (typeof window === 'undefined') return null
  const w = window as DesktopWindow
  return w.__FREEAPI_DESKTOP__ === true && typeof w.__FREEAPI_SESSION__ === 'function'
    ? w.__FREEAPI_SESSION__
    : null
}

// The same dashboard opened in a normal browser tab on a desktop install has no
// preload bridge, so the server mints the session instead (#1399). It only
// does so for a request from this computer, and says so through `desktop` on
// /api/auth/status; web and Docker installs never set it and keep their login.
async function browserDesktopSession(): Promise<string> {
  const res = await apiFetch<{ token: string }>('/api/auth/desktop-session', { method: 'POST' })
  return res.token
}

export interface AuthStatus {
  needsSetup: boolean
  authenticated: boolean
  email: string | null
  motherId?: string | null
  companyName?: string | null
  apiKey?: string | null
  desktop?: boolean
}

function Centered({ children }: { children: ReactNode }) {
  // dvh, not vh: on mobile the collapsing URL bar and the software keyboard both
  // change the viewport, and 100vh leaves the card parked mid-scroll.
  return (
    <main className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}

function AuthForm({ mode, onAuthed }: { mode: 'setup' | 'login'; onAuthed: () => void }) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'login' | 'register'>(mode === 'setup' ? 'register' : 'login')
  const [qrCode, setQrCode] = useState('')
  const [verifyingQr, setVerifyingQr] = useState(false)
  const [verifiedCompany, setVerifiedCompany] = useState<{ motherId: string; companyName: string } | null>(null)
  const [qrVerifyError, setQrVerifyError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [codeRequired, setCodeRequired] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [legalOpen, setLegalOpen] = useState(false)
  const [legalTab, setLegalTab] = useState<'terms' | 'privacy'>('terms')

  const isRegister = activeTab === 'register'

  // Clean and extract QR code from pasted text or URL
  function handleQrChange(val: string) {
    let cleanVal = val.trim()
    if (cleanVal.includes('qrCode=') || cleanVal.includes('code=')) {
      const match = cleanVal.match(/(?:qrCode|code)=([^&\s]+)/i)
      if (match?.[1]) {
        cleanVal = decodeURIComponent(match[1])
      }
    }
    setQrCode(cleanVal)
    setQrVerifyError('')
    if (verifiedCompany) {
      setVerifiedCompany(null)
    }
  }

  // Verify QR code with backend
  async function verifyQrCode(codeToVerify?: string): Promise<{ motherId: string; companyName: string } | null> {
    const code = (codeToVerify ?? qrCode).trim()
    if (!code) {
      setQrVerifyError('Please enter or scan your PolarList QR / Scan code')
      setVerifiedCompany(null)
      return null
    }

    setVerifyingQr(true)
    setQrVerifyError('')
    try {
      const res = await apiFetch<{
        valid: boolean
        motherId?: string | number | null
        companyName?: string | null
        message?: string
      }>('/api/auth/validate-qr', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })

      if (res.valid && res.motherId) {
        const info = {
          motherId: String(res.motherId),
          companyName: res.companyName || `Company ${res.motherId}`,
        }
        setVerifiedCompany(info)
        setQrVerifyError('')
        return info
      } else {
        setVerifiedCompany(null)
        setQrVerifyError(res.message || 'Invalid PolarList scan code. Only verified company users can register.')
        return null
      }
    } catch (err: any) {
      setVerifiedCompany(null)
      setQrVerifyError(err.message || 'Failed to verify QR code with Polar backend')
      return null
    } finally {
      setVerifyingQr(false)
    }
  }

  const qrCodeError = isRegister && !qrCode.trim()
    ? 'PolarList QR code or scan key is required to register a company'
    : null

  const emailError = !email.trim()
    ? t('validation.required')
    : isRegister && !isEmail(email)
      ? t('validation.email')
      : null
  const passwordError = !password
    ? t('validation.required')
    : isRegister && password.length < PASSWORD_MIN
      ? t('validation.passwordMin', { min: PASSWORD_MIN })
      : null

  const showQrError = attempted && (!qrCode.trim() || !!qrVerifyError)
  const showEmailError = attempted && !!emailError
  const showPasswordError = attempted && !!passwordError

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (emailError || passwordError) {
      setAttempted(true)
      return
    }

    if (isRegister) {
      if (!qrCode.trim()) {
        setAttempted(true)
        return
      }

      // Strict enforcement: Must verify QR code before registration can proceed
      let company = verifiedCompany
      if (!company) {
        setBusy(true)
        company = await verifyQrCode(qrCode.trim())
        if (!company) {
          setBusy(false)
          setAttempted(true)
          return
        }
      }
    }

    setBusy(true)
    setError('')
    try {
      const payload: Record<string, string> = { email, password }
      if (isRegister) {
        payload.qrCode = qrCode.trim()
      }
      if (setupCode) payload.setupCode = setupCode.trim()

      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      const res = await apiFetch<{ token: string; jwtToken?: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setToken(res.jwtToken || res.token)
      onAuthed()
    } catch (err: any) {
      if ((err as ApiError).code === 'setup_code_required') {
        setCodeRequired(true)
      }
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (showForgot && !isRegister) {
    return <ForgotPasswordForm onBack={() => setShowForgot(false)} onAuthed={onAuthed} initialEmail={email} />
  }

  return (
    <Centered>
      <div className="mb-6 flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-foreground" />
        <span className="font-semibold tracking-tight text-sm">PolarAI</span>
        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary ms-auto">
          Multi-Tenant
        </span>
      </div>

      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex border-b border-border/60 mb-5">
          <button
            type="button"
            onClick={() => { setActiveTab('login'); setError(''); setAttempted(false); }}
            className={`flex-1 pb-2.5 text-xs font-semibold border-b-2 transition-colors ${
              !isRegister
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('auth.signIn')}
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('register'); setError(''); setAttempted(false); }}
            className={`flex-1 pb-2.5 text-xs font-semibold border-b-2 transition-colors ${
              isRegister
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Register Company
          </button>
        </div>

        <h1 className="text-base font-semibold tracking-tight">
          {isRegister ? 'Register with PolarList QR' : t('auth.signIn')}
        </h1>
        <p className="text-xs text-muted-foreground mt-1 mb-5">
          {isRegister
            ? 'Scan or enter your PolarList QR key to link verified company identity and get a dedicated LLM gateway.'
            : 'Sign in to access your tenant LLM gateway, API keys, and models.'}
        </p>

        <form onSubmit={submit} className="space-y-3.5" noValidate>
          {isRegister && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1.5" htmlFor="auth-qr-code">
                  <QrCode className="size-3.5 text-primary" />
                  PolarList QR / Scan Code <span className="text-destructive">*</span>
                </Label>
                {verifiedCompany && (
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Verified
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  id="auth-qr-code"
                  type="text"
                  value={qrCode}
                  onChange={e => handleQrChange(e.target.value)}
                  placeholder="Paste PLQR-... or registration link"
                  className="font-mono text-xs"
                  aria-invalid={showQrError}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => verifyQrCode()}
                  disabled={verifyingQr || !qrCode.trim()}
                  className="shrink-0 text-xs px-3 font-semibold"
                >
                  {verifyingQr ? <Loader2 className="size-3.5 animate-spin" /> : 'Verify'}
                </Button>
              </div>

              {attempted && qrCodeError && (
                <FieldError id="auth-qr-error" error={qrCodeError} />
              )}
              {qrVerifyError && (
                <p className="text-[11px] text-destructive mt-1 flex items-center gap-1">
                  <AlertCircle className="size-3 shrink-0" />
                  {qrVerifyError}
                </p>
              )}

              {/* Verified Company Banner */}
              {verifiedCompany && (
                <div className="mt-2 p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-950/20 text-xs space-y-0.5 animate-in fade-in">
                  <div className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <Building2 className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{verifiedCompany.companyName}</span>
                  </div>
                  <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                    Mother ID: <span className="font-mono font-medium">{verifiedCompany.motherId}</span> • Active PolarList Tenant
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs font-medium" htmlFor="auth-email">
              {t('auth.email')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="username"
              autoFocus={!isRegister}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              aria-invalid={showEmailError}
              aria-describedby={showEmailError ? 'auth-email-error' : undefined}
            />
            {attempted && <FieldError id="auth-email-error" error={emailError} />}
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium" htmlFor="auth-password">
              {t('auth.password')} <span className="text-destructive">*</span>
            </Label>
            <PasswordInput
              id="auth-password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isRegister ? t('auth.passwordPlaceholderSetup') : t('auth.passwordPlaceholderLogin')}
              aria-invalid={showPasswordError}
              aria-describedby={showPasswordError ? 'auth-password-error' : undefined}
            />
            {attempted && <FieldError id="auth-password-error" error={passwordError} />}
          </div>

          {isRegister && codeRequired && (
            <div className="space-y-1">
              <Label className="text-xs font-medium" htmlFor="auth-setup-code">{t('auth.setupCode')}</Label>
              <Input
                id="auth-setup-code"
                type="text"
                autoComplete="off"
                value={setupCode}
                onChange={e => setSetupCode(e.target.value)}
                placeholder={t('auth.setupCodePlaceholder')}
                aria-describedby="auth-setup-code-hint"
              />
              <p id="auth-setup-code-hint" className="text-xs text-muted-foreground">{t('auth.setupCodeHint')}</p>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full h-10 mt-1" disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {busy ? (isRegister ? 'Registering Account...' : t('auth.signingIn')) : isRegister ? (verifiedCompany ? `Register for ${verifiedCompany.companyName}` : 'Verify QR & Register Company') : t('auth.signIn')}
          </Button>
        </form>

        {!isRegister && (
          <button
            type="button"
            onClick={() => setShowForgot(true)}
            className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('auth.forgotPassword')}
          </button>
        )}

        {/* PolarList Legal Notice & Links */}
        <div className="mt-4 pt-3.5 border-t border-border/50 text-center text-[11px] text-muted-foreground leading-normal">
          By signing in or registering, you agree to our{' '}
          <button
            type="button"
            onClick={() => { setLegalTab('terms'); setLegalOpen(true); }}
            className="font-medium text-primary hover:underline underline-offset-2"
          >
            Terms &amp; Conditions
          </button>
          {' '}and{' '}
          <button
            type="button"
            onClick={() => { setLegalTab('privacy'); setLegalOpen(true); }}
            className="font-medium text-primary hover:underline underline-offset-2"
          >
            Privacy Policy
          </button>
          .
        </div>
      </div>

      <LegalModal
        open={legalOpen}
        onOpenChange={setLegalOpen}
        initialTab={legalTab}
      />
    </Centered>
  )
}

// Forgot / Reset password flow

type ForgotStep = 'request' | 'reset' | 'done'

function ForgotPasswordForm({
  onBack,
  onAuthed,
  initialEmail = '',
}: {
  onBack: () => void
  onAuthed: () => void
  initialEmail?: string
}) {
  const { t } = useI18n()
  const [step, setStep] = useState<ForgotStep>('request')
  const [email, setEmail] = useState(initialEmail)
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => {
      setCooldown(c => Math.max(0, c - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const emailError = email.trim() && !isEmail(email)
    ? t('validation.email')
    : null

  const passwordError = !newPassword
    ? t('validation.required')
    : newPassword.length < PASSWORD_MIN
      ? t('validation.passwordMin', { min: PASSWORD_MIN })
      : null

  const confirmError = confirmPassword && confirmPassword !== newPassword
    ? 'Passwords do not match'
    : null

  const codeError = !resetCode.trim() ? t('validation.required') : null

  async function requestCode(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (emailError) {
      setAttempted(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      await apiFetch<{ success: boolean; email?: string; message?: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(email.trim() ? { email: email.trim() } : {}),
      })
      setStep('reset')
      setCooldown(30)
      setAttempted(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    if (codeError || passwordError || confirmError) {
      setAttempted(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch<{
        token?: string
        jwtToken?: string
        apiKey?: string
        email?: string
        motherId?: string
        companyName?: string
      }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          ...(email.trim() ? { email: email.trim() } : {}),
          resetCode: resetCode.trim(),
          newPassword,
        }),
      })

      // Store tokens and company metadata
      if (res.token) {
        setToken(res.token)
      }
      if (res.jwtToken) {
        localStorage.setItem('freellmapi_jwt', res.jwtToken)
      }
      if (res.motherId) {
        localStorage.setItem('freellmapi_mother_id', res.motherId)
      }
      if (res.companyName) {
        localStorage.setItem('freellmapi_company_name', res.companyName)
      }

      if (res.token || res.jwtToken) {
        onAuthed()
        return
      }
      setStep('done')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <div className="mb-6 flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-foreground" />
        <span className="font-semibold tracking-tight text-sm">PolarAI</span>
      </div>
      <div className="rounded-3xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">{t('auth.forgotPassword')}</h1>
            <p className="text-xs text-muted-foreground">
              {step === 'request' ? 'Request a verification code' : 'Set a new password'}
            </p>
          </div>
        </div>

        {step === 'request' && (
          <form onSubmit={requestCode} className="space-y-4" noValidate>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Enter the email address registered with your account. We will send a unique 6-digit reset code to your inbox.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="forgot-email">
                Account Email <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  aria-invalid={attempted && !!emailError}
                  className="ps-9"
                />
                <Mail className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              {attempted && <FieldError error={emailError} />}
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full h-10" disabled={busy}>
              {busy ? <Loader2 className="animate-spin size-4 me-2" /> : null}
              {busy ? t('auth.requestingResetCode') : t('auth.requestResetCode')}
            </Button>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={submitReset} className="space-y-3.5" noValidate>
            <div className="rounded-xl border border-border/80 bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-medium text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-emerald-500" /> Reset code sent!
              </p>
              <p className="text-muted-foreground">
                We sent a 6-digit code to <strong className="text-foreground">{email}</strong>.
              </p>
              <button
                type="button"
                onClick={() => { setStep('request'); setError(''); setAttempted(false); }}
                className="text-[11px] text-primary hover:underline font-medium pt-1 block"
              >
                Change email address
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium" htmlFor="reset-code">
                  6-Digit Verification Code <span className="text-destructive">*</span>
                </Label>
                <button
                  type="button"
                  disabled={busy || cooldown > 0}
                  onClick={() => requestCode()}
                  className="text-[11px] text-primary hover:underline disabled:opacity-50 disabled:no-underline font-medium"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
                </button>
              </div>
              <Input
                id="reset-code"
                type="text"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={resetCode}
                onChange={e => setResetCode(e.target.value.replace(/[^0-9a-zA-Z]/g, ''))}
                placeholder="e.g. 582914"
                aria-invalid={attempted && !!codeError}
                className="font-mono text-base tracking-widest text-center h-10"
              />
              {attempted && <FieldError error={codeError} />}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reset-new-password">
                {t('auth.newPassword')} <span className="text-destructive">*</span>
              </Label>
              <PasswordInput
                id="reset-new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholderSetup')}
                aria-invalid={attempted && !!passwordError}
              />
              {attempted && <FieldError error={passwordError} />}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium" htmlFor="reset-confirm-password">
                Confirm Password <span className="text-destructive">*</span>
              </Label>
              <PasswordInput
                id="reset-confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                aria-invalid={attempted && !!confirmError}
              />
              {attempted && <FieldError error={confirmError} />}
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full h-10 mt-1" disabled={busy}>
              {busy ? <Loader2 className="animate-spin size-4 me-2" /> : null}
              {busy ? 'Updating Password...' : 'Reset Password & Sign In'}
            </Button>
          </form>
        )}

        {step === 'done' && (
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 className="size-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-medium text-foreground">{t('auth.passwordReset')}</p>
            <p className="text-xs text-muted-foreground">Your password has been updated successfully.</p>
            <Button onClick={onBack} className="w-full">
              Proceed to Sign In
            </Button>
          </div>
        )}

        <button
          type="button"
          onClick={onBack}
          className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" /> {t('auth.backToLogin')}
        </button>
      </div>
    </Centered>
  )
}

// Change-credentials modal (rendered inside the authenticated shell)

interface ChangeCredentialsModalProps {
  mode: 'password' | 'email'
  onClose: () => void
}

export function ChangeCredentialsModal({ mode, onClose }: ChangeCredentialsModalProps) {
  const { t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newValue, setNewValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const isPassword = mode === 'password'

  const newValueError = !newValue.trim()
    ? t('validation.required')
    : isPassword && newValue.length < PASSWORD_MIN
      ? t('validation.passwordMin', { min: PASSWORD_MIN })
      : !isPassword && !isEmail(newValue)
        ? t('validation.email')
        : null
  const currentPwError = !currentPassword ? t('validation.required') : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (newValueError || currentPwError) {
      setAttempted(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      if (isPassword) {
        await apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword: newValue }),
        })
        toast.success(t('auth.passwordChanged'))
      } else {
        await apiFetch('/api/auth/change-email', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newEmail: newValue }),
        })
        toast.success(t('auth.emailChanged'))
      }
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-3xl border bg-card p-6 shadow-xl">
        <h2 className="text-base font-medium mb-1">
          {isPassword ? t('auth.changePassword') : t('auth.changeEmail')}
        </h2>
        <form onSubmit={submit} className="space-y-3 mt-4" noValidate>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cred-current-password">{t('auth.currentPassword')}</Label>
            <PasswordInput
              id="cred-current-password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholderLogin')}
              aria-invalid={attempted && !!currentPwError}
            />
            {attempted && <FieldError error={currentPwError} />}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="cred-new-value">
              {isPassword ? t('auth.newPassword') : t('auth.newEmail')}
            </Label>
            {isPassword ? <PasswordInput
              id="cred-new-value"
              autoComplete="new-password"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder={t('auth.passwordPlaceholderSetup')}
              aria-invalid={attempted && !!newValueError}
            /> : <Input
              id="cred-new-value"
              type="email"
              autoComplete="email"
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              aria-invalid={attempted && !!newValueError}
            />}
            {attempted && <FieldError error={newValueError} />}
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy
                ? (isPassword ? t('auth.changingPassword') : t('auth.changingEmail'))
                : t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function useAuthStatus() {
  return useQuery<AuthStatus>({
    queryKey: ['auth-status'],
    queryFn: () => apiFetch('/api/auth/status'),
    staleTime: 30_000,
  })
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useAuthStatus()

  useEffect(() => {
    const handler = () => { refetch() }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [refetch])

  // Desktop self-repair: one attempt at a time, and none after the shell has
  // handed back a session the server still rejects — a broken install shows a
  // message instead of looping.
  const desktopSession = desktopSessionBridge() ?? (data?.desktop ? browserDesktopSession : null)
  const desktopNeedsSession = !!desktopSession && !!data && (data.needsSetup || !data.authenticated)
  const repairing = useRef(false)
  const [repairFailed, setRepairFailed] = useState(false)
  useEffect(() => {
    if (!desktopNeedsSession || !desktopSession || repairing.current || repairFailed) return
    repairing.current = true
    ;(async () => {
      try {
        const token = await desktopSession()
        if (!token) throw new Error('empty session token')
        setToken(token)
        queryClient.invalidateQueries()
        const next = await refetch()
        if (!next.data?.authenticated) setRepairFailed(true)
      } catch (err) {
        console.error('[auth-gate] desktop session repair failed', err)
        setRepairFailed(true)
      } finally {
        repairing.current = false
      }
    })()
  }, [desktopNeedsSession, desktopSession, repairFailed, queryClient, refetch])

  function onAuthed() {
    // New session: drop any cached (unauthenticated) data and re-check status.
    queryClient.invalidateQueries()
    refetch()
  }

  if (isLoading) {
    return (
      <Centered>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t('auth.loading')}
        </p>
      </Centered>
    )
  }
  if (isError || !data) {
    return (
      <Centered>
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {t('auth.serverUnreachableBefore')}<code className="font-mono">npm run dev</code>{t('auth.serverUnreachableAfter')}
        </div>
      </Centered>
    )
  }

  if (desktopNeedsSession) {
    if (repairFailed) {
      return (
        <Centered>
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            {t('auth.desktopSessionFailed')}
          </div>
        </Centered>
      )
    }
    return <Centered><p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden />{t('auth.loading')}</p></Centered>
  }
  if (data.needsSetup) return <AuthForm mode="setup" onAuthed={onAuthed} />
  if (!data.authenticated) return <AuthForm mode="login" onAuthed={onAuthed} />

  return <>{children}</>
}

