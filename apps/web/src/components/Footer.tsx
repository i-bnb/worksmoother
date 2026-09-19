import React from 'react';
import { Shield, Key, Database, CheckCircle2 } from 'lucide-react';

export function Footer() {
  return (
    <footer className="mt-20 border-t border-[#0B1533]/[0.08] bg-white">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Col 1: Platform */}
          <div className="space-y-3 md:col-span-1">
            <span className="text-base font-extrabold text-[#0B1533] tracking-tight">
              DoctorCare Engine
            </span>
            <p className="text-xs text-[#4A5578] leading-relaxed">
              Enterprise healthcare platform engineered on Cloudflare Workers, Cloudflare Secrets Store,
              Cloudflare D1 physical isolation, and DPDP Act 2023 compliance.
            </p>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-[#6B7596] font-mono">
              <span>origin: github.com/itsmesyaam/doctorcare</span>
            </div>
          </div>

          {/* Col 2: Security Specifications */}
          <div className="space-y-2.5">
            <span className="text-xs font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Cryptographic Core
            </span>
            <ul className="space-y-2 text-xs text-[#4A5578]">
              <li className="flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5 text-[#2B59FF]" />
                <span>Secrets Store KEK (kek-2026-09)</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-[#15803D]" />
                <span>AES-256-GCM + 5-Tuple AAD</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#15803D]" />
                <span>Non-Extractable CryptoKey</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-[#7C8CF8]" />
                <span>Fail-Closed RECORD_ACCESS_LOG</span>
              </li>
            </ul>
          </div>

          {/* Col 3: Compliance & Architecture */}
          <div className="space-y-2.5">
            <span className="text-xs font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Compliance &amp; Edge
            </span>
            <ul className="space-y-1.5 text-xs text-[#4A5578]">
              <li>Cloudflare Pro Zone Managed WAF</li>
              <li>OWASP ModSecurity Core Ruleset</li>
              <li>India DPDP Act 2023 Consent Audit</li>
              <li>HIPAA § 164.312 Access Audit Vault</li>
              <li>Write-Only R2 Immutable Hash Chain</li>
            </ul>
          </div>

          {/* Col 4: Fleet Architecture */}
          <div className="space-y-2.5">
            <span className="text-xs font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Workers Fleet
            </span>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#F4F6FB] border border-[#0B1533]/[0.06]">
                <span className="font-mono text-[#2B59FF] font-semibold">doctorcare-api</span>
                <span className="text-[10px] text-[#6B7596]">Public Gateway</span>
              </div>
              <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#F4F6FB] border border-[#0B1533]/[0.06]">
                <span className="font-mono text-[#15803D] font-semibold">doctorcare-records</span>
                <span className="text-[10px] text-[#6B7596]">Private Binding</span>
              </div>
              <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#F4F6FB] border border-[#0B1533]/[0.06]">
                <span className="font-mono text-[#7C8CF8] font-semibold">doctorcare-notify</span>
                <span className="text-[10px] text-[#6B7596]">Queue Consumer</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-[#0B1533]/[0.06] flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-[#6B7596]">
          <div>
            &copy; 2026 DoctorCare Platform &bull; All clinical records encrypted end-to-end under Secrets Store KEK.
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#15803D] animate-ping" />
              <span>Edge Network: Online (Global Anycast)</span>
            </span>
            <span>&bull;</span>
            <span>Cloudflare D1 Physical Isolation</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
