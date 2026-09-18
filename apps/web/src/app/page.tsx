import React from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Lock,
  Calendar,
  Stethoscope,
  FileCheck,
  ArrowUpRight,
  Layers,
  Database,
  Cpu,
  KeyRound,
  FileText,
  Clock,
  Sparkles,
} from 'lucide-react';

export default function HomePage() {
  const telemetryItems = [
    {
      title: 'Cloudflare Pro Zone WAF',
      status: 'Protected',
      badge: 'CRS v3.3 Active',
      desc: 'OWASP ModSecurity Core Ruleset with anomaly scoring on api.yourhospital.com.',
      color: 'emerald',
      icon: ShieldCheck,
    },
    {
      title: 'Secrets Store KEK',
      status: 'Active',
      badge: 'kek-2026-09',
      desc: 'Bound exclusively to private records Worker. Non-extractable CryptoKey.',
      color: 'blue',
      icon: KeyRound,
    },
    {
      title: 'Dual Appwrite Isolation',
      status: 'Enforced',
      badge: 'Project A + B',
      desc: 'Operational data strictly decoupled from encrypted clinical records (PHI).',
      color: 'purple',
      icon: Database,
    },
    {
      title: '4-Layer Rate Limiting',
      status: 'Throttling Active',
      badge: 'Zero Distributed Races',
      desc: 'Zone WAF, Workers bindings, exact Durable Object counters, and business caps.',
      color: 'amber',
      icon: Layers,
    },
  ];

  const quickNavs = [
    {
      title: 'Doctor & Clinic Directory',
      category: 'Care Network',
      description: 'Explore verified specialists across Cardiology, Oncology, Neurology, and Pediatrics with server-derived fees.',
      href: '/directory',
      icon: Stethoscope,
      accent: 'border-blue-500/30 group-hover:border-blue-500/60',
    },
    {
      title: 'Atomic Slot Reservation',
      category: 'Slot Durable Object',
      description: 'Single-threaded booking mutations sharded per doctor-day with automated 10-minute hold expiration.',
      href: '/booking',
      icon: Calendar,
      accent: 'border-emerald-500/30 group-hover:border-emerald-500/60',
    },
    {
      title: 'Encrypted Medical Vault',
      category: 'HIPAA § 164.312',
      description: 'Protected Health Information envelope encryption with fresh 32-byte DEKs and tamper-evident hash-chained R2 vault.',
      href: '/records',
      icon: Lock,
      accent: 'border-purple-500/30 group-hover:border-purple-500/60',
    },
    {
      title: 'DPDP Consent Ledger',
      category: 'Data Protection 2023',
      description: 'Granular consent tracking with purpose notice, version control, and instant right-to-withdraw enforcement.',
      href: '/consent',
      icon: FileCheck,
      accent: 'border-amber-500/30 group-hover:border-amber-500/60',
    },
  ];

  return (
    <div className="space-y-16 py-6">
      {/* Apple-Style Minimalist Hero */}
      <section className="relative pt-8 pb-12 text-center max-w-4xl mx-auto space-y-6">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs text-zinc-300 font-medium tracking-wide shadow-inner">
          <Sparkles className="h-3.5 w-3.5 text-blue-400" />
          <span>DoctorCare Healthcare Engine &bull; Zero-Trust Platform</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white leading-[1.1]">
          Healthcare engineered with{' '}
          <span className="bg-gradient-to-r from-blue-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
            zero-trust precision.
          </span>
        </h1>

        <p className="text-base sm:text-lg text-zinc-400 font-normal leading-relaxed max-w-2xl mx-auto">
          Multi-Worker Cloudflare fleet with non-extractable WebCrypto KEK encryption,
          fail-closed audit logging, and mathematical hash-chaining verification.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
          <Link href="/directory" className="apple-btn-primary flex items-center gap-2 text-sm">
            <span>Explore Care Directory</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link href="/records" className="apple-btn-secondary flex items-center gap-2 text-sm">
            <Lock className="h-4 w-4 text-purple-400" />
            <span>Open Medical Vault</span>
          </Link>
        </div>
      </section>

      {/* Telemetry Strip */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 font-mono">
            Platform Security & Infrastructure Telemetry
          </h2>
          <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            All Subsystems Nominal
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {telemetryItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="glass-panel rounded-2xl p-5 space-y-3 transition-all hover:border-white/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] border border-white/10 text-white">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-zinc-300 border border-white/10">
                    {item.badge}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white tracking-tight">{item.title}</h3>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Core Operational Modules */}
      <section className="space-y-4">
        <div className="px-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 font-mono">
            Healthcare Workflows & Modules
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {quickNavs.map((nav) => {
            const Icon = nav.icon;
            return (
              <Link
                key={nav.title}
                href={nav.href}
                className={`glass-panel-interactive group rounded-3xl p-6 block relative overflow-hidden ${nav.accent}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] border border-white/10 text-white group-hover:scale-105 transition-transform">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-mono text-zinc-400 flex items-center gap-1 group-hover:text-white transition-colors">
                    Access View
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </div>

                <div className="mt-5 space-y-1.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-blue-400 font-medium">
                    {nav.category}
                  </span>
                  <h3 className="text-lg font-semibold text-white tracking-tight">{nav.title}</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{nav.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Architectural Guarantees */}
      <section className="glass-panel rounded-3xl p-8 space-y-6 border border-white/10">
        <div className="max-w-2xl space-y-2">
          <span className="text-xs font-mono text-emerald-400 uppercase tracking-widest font-semibold">
            Zero-Trust Architectural Guarantees
          </span>
          <h3 className="text-2xl font-bold tracking-tight text-white">
            Built from first principles for HIPAA & DPDP compliance.
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
          <div className="space-y-2 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
            <span className="text-xs font-semibold text-white font-mono flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-400" />
              Fail-Closed Audit Enforcement
            </span>
            <p className="text-xs text-zinc-400 leading-relaxed">
              The records Worker writes access events to Appwrite Project B RECORD_ACCESS_LOG before clinical data is decrypted. Zero plaintext is leaked on audit failure.
            </p>
          </div>

          <div className="space-y-2 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
            <span className="text-xs font-semibold text-white font-mono flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Immutable Hash-Chain Vault
            </span>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Every access log is mirrored to write-only Cloudflare R2 bucket doctorcare-audit-vault with mathematical SHA-256 hash chaining to detect any tampering.
            </p>
          </div>

          <div className="space-y-2 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
            <span className="text-xs font-semibold text-white font-mono flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Four-Layer Rate Limiting
            </span>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Zone WAF L7 rules, Workers RateLimit bindings, exact Durable Object counters, and domain caps prevent slot hoarding, scraping, and doctor exfiltration.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
