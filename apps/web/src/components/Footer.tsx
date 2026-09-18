import React from 'react';
import { Shield, Key, Database, Cpu, CheckCircle2 } from 'lucide-react';

export function Footer() {
  return (
    <footer className="mt-20 border-t border-white/[0.08] bg-black/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Col 1: Platform */}
          <div className="space-y-3 md:col-span-1">
            <span className="text-sm font-semibold text-white tracking-tight">DoctorCare Engine</span>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Enterprise healthcare platform engineered on Cloudflare Workers, Cloudflare Secrets Store, and Appwrite Cloud dual-project credential isolation.
            </p>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-zinc-500 font-mono">
              <span>origin: github.com/itsmesyaam/doctorcare</span>
            </div>
          </div>

          {/* Col 2: Security Specifications */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
              Cryptographic Core
            </span>
            <ul className="space-y-1.5 text-xs text-zinc-400">
              <li className="flex items-center gap-1.5">
                <Key className="h-3 w-3 text-blue-400" />
                <span>Secrets Store KEK (kek-2026-09)</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Shield className="h-3 w-3 text-emerald-400" />
                <span>AES-256-GCM + 5-Tuple AAD</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                <span>Non-Extractable CryptoKey</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Database className="h-3 w-3 text-purple-400" />
                <span>Fail-Closed RECORD_ACCESS_LOG</span>
              </li>
            </ul>
          </div>

          {/* Col 3: Compliance & Architecture */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
              Compliance & Edge
            </span>
            <ul className="space-y-1.5 text-xs text-zinc-400">
              <li>Cloudflare Pro Zone Managed WAF</li>
              <li>OWASP ModSecurity Core Ruleset</li>
              <li>India DPDP Act 2023 Consent Audit</li>
              <li>HIPAA § 164.312 Access Audit Vault</li>
              <li>Write-Only R2 Immutable Hash Chain</li>
            </ul>
          </div>

          {/* Col 4: Fleet Architecture */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
              Workers Fleet
            </span>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.03] border border-white/5">
                <span className="font-mono text-blue-400">doctorcare-api</span>
                <span className="text-[10px] text-zinc-500">Public Gateway</span>
              </div>
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.03] border border-white/5">
                <span className="font-mono text-emerald-400">doctorcare-records</span>
                <span className="text-[10px] text-zinc-500">Private Binding</span>
              </div>
              <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.03] border border-white/5">
                <span className="font-mono text-purple-400">doctorcare-notify</span>
                <span className="text-[10px] text-zinc-500">Queue Consumer</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-white/[0.05] flex flex-col md:flex-row items-center justify-between gap-4 text-[11px] text-zinc-500">
          <div>
            &copy; 2026 DoctorCare Platform. All clinical records encrypted end-to-end under Secrets Store KEK.
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Edge Network: Online (Global Anycast)</span>
            </span>
            <span>&bull;</span>
            <span>Appwrite Cloud Project A & B Isolated</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
