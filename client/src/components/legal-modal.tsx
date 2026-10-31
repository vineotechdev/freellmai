import { useState } from 'react'
import {
  ShieldCheck,
  ExternalLink,
  Lock,
  Scale,
  X,
  Building,
} from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'

const EXTERNAL_PRIVACY_POLICY_URL = 'https://sites.google.com/view/madver-privacypolicy/polarlistprivacy-policy?authuser=0'

export type LegalTab = 'terms' | 'privacy'

export interface LegalModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: LegalTab
}

export function LegalModal({
  open,
  onOpenChange,
  initialTab = 'terms',
}: LegalModalProps) {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup maxWidth="max-w-2xl" className="flex flex-col max-h-[88vh] p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              {activeTab === 'terms' ? <Scale className="size-4" /> : <ShieldCheck className="size-4" />}
            </div>
            <div>
              <DialogTitle className="text-base font-semibold leading-tight">
                {activeTab === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                PolarList & PolarAI Legal Terms
              </p>
            </div>
          </div>
          <DialogClose
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </DialogClose>
        </div>

        {/* Tab switcher */}
        <div className="px-6 pt-4 pb-2 border-b bg-background flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            value={activeTab}
            onValueChange={val => setActiveTab(val as LegalTab)}
            options={[
              { value: 'terms', label: 'Terms & Conditions' },
              { value: 'privacy', label: 'Privacy Policy' },
            ]}
          />

          <a
            href={EXTERNAL_PRIVACY_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
          >
            Full External Policy <ExternalLink className="size-3" />
          </a>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm space-y-5 leading-relaxed text-foreground/90">
          {/* Supplementary Notice Box */}
          <div className="p-3.5 rounded-2xl border border-primary/20 bg-primary/5 text-xs space-y-1.5 text-muted-foreground">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <Lock className="size-3.5 text-primary" />
              <span>Supplementary Agreement (Updated February 2026)</span>
            </div>
            <p>
              For detailed information about how we collect, use, and protect your data, please review our full Privacy Policy at{' '}
              <a
                href={EXTERNAL_PRIVACY_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-semibold underline underline-offset-2 hover:opacity-80"
              >
                PolarList Privacy Policy
              </a>
              . This policy is supplementary and in addition to the terms outlined below.
            </p>
          </div>

          {activeTab === 'terms' ? (
            <div className="space-y-4">
              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">1</span>
                  Acceptance of Terms
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  By accessing or using Polarlist and PolarAI, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use our services.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">2</span>
                  Description of Service
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  Polarlist provides an integrated team communication, enterprise collaboration, and PolarAI LLM gateway platform for businesses. Features include messaging, file sharing, event management, notifications, and AI acceleration services.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">3</span>
                  User Accounts
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  You are responsible for maintaining the security of your account credentials. You must provide accurate information during registration and belong to an active, verified PolarList company tenant.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">4</span>
                  Acceptable Use
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  You agree not to use the service for any unlawful purpose or in a way that could damage, disable, overburden, or impair the service or interfere with any other party's use of the service.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">5</span>
                  Privacy
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  Your use of the service is also governed by our Privacy Policy. Please review it to understand our practices regarding information collection and storage.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">6</span>
                  Content
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  You retain ownership of content you share through the platform. By sharing content, you grant Polarlist a license to securely store, process, and display it within the service for the benefit of your tenant.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">7</span>
                  Termination
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We reserve the right to suspend or terminate accounts that violate these terms, compromise system security, or become inactive for extended periods.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">8</span>
                  Limitation of Liability
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  Polarlist and PolarAI are provided "as is" without warranties of any kind. We shall not be liable for any indirect, incidental, or consequential damages arising from the use of the platform.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">9</span>
                  Changes to Terms
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We may update these terms from time to time. Continued use of the service constitutes acceptance of updated terms.
                </p>
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">1</span>
                  Information We Collect
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We collect information you provide during registration (name, email, company tenant details) and data generated through your use of the service (messages, files, LLM prompts, activity logs).
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">2</span>
                  How We Use Information
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We use your information to provide, maintain, and improve the service, execute requested AI models, send notifications, and ensure multi-tenant security isolation.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">3</span>
                  Data Storage
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  Your data is stored securely on our servers and encrypted repositories. We implement strict multi-tenant database partitions to protect company data.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">4</span>
                  Data Sharing
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We do not sell your personal data. We may share information with your designated company administrators as part of the normal service and access management functionality.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">5</span>
                  Cookies & Tracking
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We use essential session tokens and local storage to maintain your authentication state and tenant preferences.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">6</span>
                  Your Rights
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  You have the right to access, update, or delete your personal information. Contact your company administrator or our support team to submit data requests.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">7</span>
                  Security
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We use industry-standard encryption, tokenization, and strict QR verification security measures. Login activity is monitored and logged for your protection.
                </p>
              </section>

              <section className="space-y-1">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <span className="size-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">8</span>
                  Changes to Policy
                </h3>
                <p className="text-xs text-muted-foreground pl-6.5">
                  We may update this policy periodically. We will notify users of significant updates through the platform.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-3 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Building className="size-3.5 text-primary" />
            <span>PolarList Technologies &bull; All Rights Reserved</span>
          </div>
          <DialogClose className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
            Got it
          </DialogClose>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
