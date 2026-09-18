'use client';

import React, { useState } from 'react';
import {
  FileCheck2,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Languages,
  Info,
  ArrowRight,
  Database,
  History,
  Lock,
} from 'lucide-react';

interface ConsentItem {
  id: string;
  purpose: 'APPOINTMENT_COMMUNICATION' | 'EHR_DATA_PROCESSING' | 'PAYMENT_TELEMETRY' | 'ANONYMIZED_EPIDEMIOLOGY';
  title: string;
  description: string;
  noticeVersion: string;
  language: 'en' | 'hi' | 'mr' | 'ta';
  granted: boolean;
  grantedAt: string | null;
  withdrawnAt: string | null;
  mandatory: boolean;
}

const INITIAL_CONSENTS: ConsentItem[] = [
  {
    id: 'cst_01_comms',
    purpose: 'APPOINTMENT_COMMUNICATION',
    title: 'Appointment Communication & Notifications',
    description: 'Dispatch appointment confirmations, live hold alerts, and doctor schedule updates via Meta WhatsApp Cloud API and verified SMTP transactional email.',
    noticeVersion: 'v2.1-DPDP2023',
    language: 'en',
    granted: true,
    grantedAt: '2026-09-18T09:30:00Z',
    withdrawnAt: null,
    mandatory: true,
  },
  {
    id: 'cst_02_ehr',
    purpose: 'EHR_DATA_PROCESSING',
    title: 'Electronic Health Record (EHR) Storage & Decryption',
    description: 'Store and envelope-encrypt medical history, laboratory observations, and discharge summaries in Appwrite Project B with AES-256-GCM and scoped KEK kek-2026-09.',
    noticeVersion: 'v2.1-DPDP2023',
    language: 'en',
    granted: true,
    grantedAt: '2026-09-18T09:30:00Z',
    withdrawnAt: null,
    mandatory: true,
  },
  {
    id: 'cst_03_payment',
    purpose: 'PAYMENT_TELEMETRY',
    title: 'Secure Payment & Order Reconciliation',
    description: 'Transmit payment order derivation metadata to Razorpay SDK and process cryptographically verified HMAC-SHA256 webhook callbacks.',
    noticeVersion: 'v2.1-DPDP2023',
    language: 'en',
    granted: true,
    grantedAt: '2026-09-18T09:30:00Z',
    withdrawnAt: null,
    mandatory: true,
  },
  {
    id: 'cst_04_research',
    purpose: 'ANONYMIZED_EPIDEMIOLOGY',
    title: 'Anonymized Clinical Quality & Research Insights',
    description: 'Aggregate de-identified diagnostic statistics across hospital departments for epidemiological research and clinical pathway quality improvement.',
    noticeVersion: 'v2.1-DPDP2023',
    language: 'en',
    granted: false,
    grantedAt: null,
    withdrawnAt: '2026-09-18T10:15:22Z',
    mandatory: false,
  },
];

export default function ConsentPage() {
  const [consents, setConsents] = useState<ConsentItem[]>(INITIAL_CONSENTS);
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'hi' | 'mr' | 'ta'>('en');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const toggleConsent = (id: string) => {
    setConsents(prev =>
      prev.map(item => {
        if (item.id === id) {
          if (item.mandatory && item.granted) {
            setStatusMessage(`Cannot withdraw mandatory consent "${item.title}" required for basic clinical services.`);
            setTimeout(() => setStatusMessage(null), 4000);
            return item;
          }

          const now = new Date().toISOString();
          const nextState = !item.granted;
          setStatusMessage(
            nextState
              ? `Consent granted for ${item.title}. Recorded in CONSENT_LOG.`
              : `Consent withdrawn for ${item.title}. Recorded in CONSENT_LOG.`
          );
          setTimeout(() => setStatusMessage(null), 4000);

          return {
            ...item,
            granted: nextState,
            grantedAt: nextState ? now : item.grantedAt,
            withdrawnAt: nextState ? null : now,
          };
        }
        return item;
      })
    );
  };

  return (
    <div className="space-y-10 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="apple-pill border-emerald-500/30 text-emerald-400 bg-emerald-950/20 font-mono text-xs">
            DPDP ACT 2023 COMPLIANCE
          </span>
          <span className="apple-pill border-blue-500/30 text-blue-400 bg-blue-950/20 font-mono text-xs">
            PROJECT A: CONSENT_LOG
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[#f5f5f7]">
          Patient Consent & Privacy Center
        </h1>
        <p className="text-[#86868b] mt-1 text-sm max-w-2xl">
          Granular consent management adhering strictly to the Digital Personal Data Protection (DPDP) Act 2023.
          Every grant and withdrawal is logged with immutable timestamps and notice versions.
        </p>
      </div>

      {/* Language & Notice Version Bar */}
      <div className="glass-panel p-4 rounded-xl border border-white/[0.08] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Languages className="w-4 h-4 text-[#86868b]" />
          <span className="text-xs text-[#86868b]">Notice Language:</span>
          <div className="flex items-center gap-1.5">
            {[
              { code: 'en', label: 'English' },
              { code: 'hi', label: 'हिंदी' },
              { code: 'mr', label: 'मराठी' },
              { code: 'ta', label: 'தமிழ்' },
            ].map(lang => (
              <button
                key={lang.code}
                onClick={() => setSelectedLanguage(lang.code as any)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  selectedLanguage === lang.code
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'text-[#86868b] hover:text-white'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-[#86868b]">Notice Version:</span>
          <span className="apple-pill font-mono text-[11px] border-emerald-500/30 text-emerald-400 bg-emerald-950/20">
            v2.1-DPDP2023
          </span>
        </div>
      </div>

      {/* Status Alert Toast */}
      {statusMessage && (
        <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-500/30 text-xs text-blue-200 flex items-center gap-2 animate-fade-in">
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Consent Items */}
      <div className="glass-panel rounded-2xl p-6 border border-white/[0.08] space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-[#f5f5f7] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Purpose Limitation & Permissions
            </h2>
            <p className="text-xs text-[#86868b] mt-0.5">
              Review and manage each purpose-specific processing authorization
            </p>
          </div>
          <span className="apple-pill border-white/10 text-xs text-[#86868b]">
            {consents.filter(c => c.granted).length} / {consents.length} Granted
          </span>
        </div>

        <div className="space-y-4">
          {consents.map((item) => (
            <div
              key={item.id}
              className={`p-5 rounded-xl border transition-all ${
                item.granted
                  ? 'border-white/[0.08] bg-[#0c0c10]/70'
                  : 'border-red-500/20 bg-red-950/10'
              }`}
            >
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-medium text-white">{item.title}</h3>
                    <span className="apple-pill text-[10px] font-mono border-white/10 text-[#86868b]">
                      {item.purpose}
                    </span>
                    {item.mandatory ? (
                      <span className="apple-pill text-[10px] border-amber-500/30 text-amber-400 bg-amber-950/20">
                        ESSENTIAL SERVICE
                      </span>
                    ) : (
                      <span className="apple-pill text-[10px] border-blue-500/30 text-blue-400 bg-blue-950/20">
                        OPTIONAL
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#86868b] leading-relaxed max-w-3xl">
                    {item.description}
                  </p>

                  <div className="flex items-center gap-4 text-[11px] text-[#86868b]/70 font-mono pt-1">
                    <span>Notice: {item.noticeVersion}</span>
                    <span>•</span>
                    {item.granted ? (
                      <span className="text-emerald-400">
                        Granted: {item.grantedAt ? item.grantedAt.substring(0, 19).replace('T', ' ') : 'N/A'} UTC
                      </span>
                    ) : (
                      <span className="text-red-400">
                        Withdrawn: {item.withdrawnAt ? item.withdrawnAt.substring(0, 19).replace('T', ' ') : 'N/A'} UTC
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => toggleConsent(item.id)}
                    className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${
                      item.granted
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 shadow-sm'
                        : 'bg-white/10 hover:bg-white/15 text-white/80 border border-white/20'
                    }`}
                  >
                    {item.granted ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Consent Active
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" />
                        Withdrawn
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DPDP Legal Safeguards Callout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="glass-panel p-4 rounded-xl border border-white/[0.08] space-y-1.5">
          <div className="flex items-center gap-2 text-white font-medium">
            <Clock className="w-4 h-4 text-emerald-400" />
            <span>Right to Withdraw</span>
          </div>
          <p className="text-[#86868b] leading-relaxed">
            Under Section 6(4) of DPDP Act 2023, data principals can withdraw consent at any time as easily as giving it.
          </p>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.08] space-y-1.5">
          <div className="flex items-center gap-2 text-white font-medium">
            <Lock className="w-4 h-4 text-blue-400" />
            <span>Purpose Specification</span>
          </div>
          <p className="text-[#86868b] leading-relaxed">
            Data is strictly processed solely for the purposes enumerated above and not retained past designated statutory periods.
          </p>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-white/[0.08] space-y-1.5">
          <div className="flex items-center gap-2 text-white font-medium">
            <Database className="w-4 h-4 text-purple-400" />
            <span>Audit Trail Ledger</span>
          </div>
          <p className="text-[#86868b] leading-relaxed">
            State transitions are written to Appwrite Project A <code className="text-white font-mono">CONSENT_LOG</code> with cryptographic timestamps.
          </p>
        </div>
      </div>
    </div>
  );
}
