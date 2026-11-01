import {
  ExternalLink,
  Cloud,
  Video,
  CheckSquare,
  Cpu,
  FileText,
  Smartphone,
  Laptop,
  CheckCircle2,
  Sparkles,
  Layers,
  ArrowRight,
  Download,
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export default function PremiumPage() {
  return (
    <div className="space-y-10 pb-16">
      {/* Page Header */}
      <PageHeader
        title="PolarList Enterprise Suite"
        description="The AI-powered team communication and collaboration platform built for Indian enterprises."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open('https://www.polarlist.in', '_blank', 'noopener')}
            >
              <ExternalLink className="size-4 mr-1.5" />
              Visit polarlist.in
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => window.open('https://play.google.com/store/apps/details?id=com.polarlist.app', '_blank', 'noopener')}
            >
              <Download className="size-4 mr-1.5" />
              Get Mobile App
            </Button>
          </div>
        }
      />

      {/* Hero Banner Card */}
      <div className="relative overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-950/30 via-background to-card p-8 md:p-12 shadow-lg">
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs px-3 py-1 font-medium">
              <Sparkles className="size-3.5 mr-1 text-blue-400" />
              Next-Gen Enterprise Platform
            </Badge>
            <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-xs px-3 py-1">
              ₹50 / user / year · 100% GST ITC Benefit
            </Badge>
          </div>

          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground">
            Microsoft Teams & Slack Alternative for Indian Enterprises
          </h1>

          <p className="text-muted-foreground text-base md:text-lg leading-relaxed">
            PolarList combines self-hosted private cloud storage, custom AI models, multi-level approval hierarchies,
            digital Permit-To-Work safety forms, and full HRMS management into a unified workspace.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs md:text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-400" />
              <span>Full Data Sovereignty</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-400" />
              <span>Private Cloud (AWS S3 / MinIO)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-400" />
              <span>End-to-End Encrypted</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-400" />
              <span>macOS, Windows, Android & iOS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Core Enterprise Features Grid */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Core Enterprise Capabilities</h2>
          <p className="text-sm text-muted-foreground">Everything your organization needs for productive and compliant team operations.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Feature 1 */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm hover:border-blue-500/40 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="size-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
                <Cloud className="size-5" />
              </div>
              <h3 className="font-semibold text-base">Self-Hosted Storage (S3 / MinIO)</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Connect your own AWS S3 or on-premise MinIO bucket. Corporate documents, files, and chat recordings stay 100% on your own infrastructure without third-party leakage.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t text-[11px] font-medium text-blue-400 flex items-center gap-1">
              <span>Complete Data Sovereignty</span>
              <ArrowRight className="size-3" />
            </div>
          </div>

          {/* Feature 2 */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm hover:border-blue-500/40 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="size-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <Cpu className="size-5" />
              </div>
              <h3 className="font-semibold text-base">Private AI & Custom Models</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Bring your own API keys for Google Gemini, OpenAI, Claude, or local LLMs. AI generates meeting summaries, assists in task workflows, and learns internal manuals without public training.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t text-[11px] font-medium text-purple-400 flex items-center gap-1">
              <span>Zero Corporate Data Retention</span>
              <ArrowRight className="size-3" />
            </div>
          </div>

          {/* Feature 3 */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm hover:border-blue-500/40 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="size-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Layers className="size-5" />
              </div>
              <h3 className="font-semibold text-base">1 to 5 Tier Approval Hierarchies</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Configurable multi-level workflow routing for Leaves, Attendance Regularizations, On-Duty (OD) Client Visits, WFH, and Force Clocking with instant push alerts and full audit logs.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t text-[11px] font-medium text-emerald-400 flex items-center gap-1">
              <span>Flexible Organizational Trees</span>
              <ArrowRight className="size-3" />
            </div>
          </div>

          {/* Feature 4 */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm hover:border-blue-500/40 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="size-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <FileText className="size-5" />
              </div>
              <h3 className="font-semibold text-base">Digital Permit-to-Work (PTW)</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Custom form designer for plant and facility safety: Hot Work, Confined Space, Electrical, and Height permits with signature captures and digital compliance trails.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t text-[11px] font-medium text-amber-400 flex items-center gap-1">
              <span>Industrial Safety & Compliance</span>
              <ArrowRight className="size-3" />
            </div>
          </div>

          {/* Feature 5 */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm hover:border-blue-500/40 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="size-11 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <CheckSquare className="size-5" />
              </div>
              <h3 className="font-semibold text-base">Integrated Task Management</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Assign and track tasks directly from team chats. Supports due dates, priorities, status pipelines, project folders, and automated follow-up reminders.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t text-[11px] font-medium text-cyan-400 flex items-center gap-1">
              <span>Chat-to-Task Automation</span>
              <ArrowRight className="size-3" />
            </div>
          </div>

          {/* Feature 6 */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm hover:border-blue-500/40 transition-all flex flex-col justify-between">
            <div className="space-y-3">
              <div className="size-11 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <Video className="size-5" />
              </div>
              <h3 className="font-semibold text-base">HD Video Calls & Group Chat</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                High-definition video and voice conferencing with screen sharing, team channels, one-on-one encrypted direct chats, and voice note attachments.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t text-[11px] font-medium text-rose-400 flex items-center gap-1">
              <span>WebRTC & Real-time Sync</span>
              <ArrowRight className="size-3" />
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">How PolarList Compares</h2>
          <p className="text-sm text-muted-foreground">Direct comparison against traditional enterprise chat software.</p>
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
          <table className="w-full text-left text-xs md:text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="p-4 font-semibold text-foreground">Capability</th>
                <th className="p-4 font-semibold text-blue-500 bg-blue-500/5">PolarList</th>
                <th className="p-4 font-semibold text-muted-foreground">Microsoft Teams</th>
                <th className="p-4 font-semibold text-muted-foreground">Slack</th>
              </tr>
            </thead>
            <tbody className="divide-y text-muted-foreground">
              <tr>
                <td className="p-4 font-medium text-foreground">Self-Hosted AWS S3 / MinIO</td>
                <td className="p-4 text-emerald-400 font-semibold bg-blue-500/5">✓ Supported (Full Sovereignty)</td>
                <td className="p-4 text-rose-400">✕ Microsoft Cloud Only</td>
                <td className="p-4 text-rose-400">✕ Salesforce Cloud Only</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-foreground">Private AI (Bring Your Own Keys)</td>
                <td className="p-4 text-emerald-400 font-semibold bg-blue-500/5">✓ Built-in (Gemini, Claude, OpenAI)</td>
                <td className="p-4 text-amber-400">△ Costly Copilot Add-on</td>
                <td className="p-4 text-amber-400">△ Costly Slack AI Add-on</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-foreground">1 to 5 Tier Approval Hierarchies</td>
                <td className="p-4 text-emerald-400 font-semibold bg-blue-500/5">✓ Built-in (Leaves, OD, WFH, Attendance)</td>
                <td className="p-4 text-rose-400">✕ Requires PowerAutomate setup</td>
                <td className="p-4 text-rose-400">✕ Requires external integrations</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-foreground">Digital Permit-to-Work (PTW)</td>
                <td className="p-4 text-emerald-400 font-semibold bg-blue-500/5">✓ Built-in Safety System</td>
                <td className="p-4 text-rose-400">✕ Not available</td>
                <td className="p-4 text-rose-400">✕ Not available</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-foreground">Integrated HRMS Management</td>
                <td className="p-4 text-emerald-400 font-semibold bg-blue-500/5">✓ Built-in (Roster, Shifts, Leaves)</td>
                <td className="p-4 text-rose-400">✕ Not included</td>
                <td className="p-4 text-rose-400">✕ Not included</td>
              </tr>
              <tr>
                <td className="p-4 font-medium text-foreground">Annual Pricing</td>
                <td className="p-4 text-blue-500 font-bold bg-blue-500/5 text-base">₹50 / user / year</td>
                <td className="p-4 text-foreground">₹6,000+ / user / year</td>
                <td className="p-4 text-foreground">₹7,500+ / user / year</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Download & Links Section */}
      <div className="rounded-3xl border bg-gradient-to-r from-card to-muted/20 p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="space-y-2 text-center md:text-left">
          <h3 className="text-xl font-bold">Download PolarList on All Your Devices</h3>
          <p className="text-xs md:text-sm text-muted-foreground">
            Available on macOS, Windows, Android, and iOS with real-time WebSocket sync.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            className="rounded-xl gap-2"
            onClick={() => window.open('https://play.google.com/store/apps/details?id=com.polarlist.app', '_blank', 'noopener')}
          >
            <Smartphone className="size-4 text-emerald-400" />
            Google Play Store
          </Button>

          <Button
            variant="outline"
            className="rounded-xl gap-2"
            onClick={() => window.open('https://apps.apple.com/in/app/polarlist/id6759520587', '_blank', 'noopener')}
          >
            <Smartphone className="size-4 text-blue-400" />
            Apple App Store
          </Button>

          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl gap-2"
            onClick={() => window.open('https://www.polarlist.in', '_blank', 'noopener')}
          >
            <Laptop className="size-4" />
            Web & Desktop
          </Button>
        </div>
      </div>
    </div>
  )
}
