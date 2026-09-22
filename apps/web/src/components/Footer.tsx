import React from 'react';
import { Shield, Key, Database, CheckCircle2 } from 'lucide-react';

export function Footer() {
  return (
    <footer className="mt-20 border-t border-[#0B1533]/[0.08] bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8 py-10 sm:py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Col 1: Hospital Overview */}
          <div className="space-y-3 md:col-span-1">
            <span className="text-base font-extrabold text-[#0B1533] tracking-tight flex items-center gap-1.5">
              DoctorCare Hospital
              <span className="sr-only">DoctorCare Engine</span>
            </span>
            <p className="text-xs text-[#4A5578] leading-relaxed">
              NABH-accredited multi-specialty hospital and digital clinic in Indiranagar, Bengaluru.
              Delivering patient-first medical care, verified specialists, and secure digital health management.
            </p>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-[#15803D] font-medium">
              <Shield className="h-3.5 w-3.5 text-[#15803D]" />
              <span>NABH Accredited &bull; DPDP Act 2023 Compliant</span>
            </div>
          </div>

          {/* Col 2: Patient Services */}
          <div className="space-y-2.5">
            <span className="text-xs font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Clinical Services
            </span>
            <ul className="space-y-2 text-xs text-[#4A5578]">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#2B59FF]" />
                <span>Outpatient Specialty Consultations (OPD)</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#15803D]" />
                <span>24x7 Emergency &amp; Trauma Resuscitation</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#15803D]" />
                <span>Comprehensive Diagnostic Pathology &amp; ECG</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#2B59FF]" />
                <span>Confidential Digital Health Vault</span>
              </li>
            </ul>
          </div>

          {/* Col 3: Bengaluru Campus & Timings */}
          <div className="space-y-2.5">
            <span className="text-xs font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Bengaluru Campus
            </span>
            <ul className="space-y-1.5 text-xs text-[#4A5578]">
              <li className="font-medium text-[#0B1533]">100 Feet Road, HAL 2nd Stage</li>
              <li>Indiranagar, Bengaluru, KA 560038</li>
              <li className="pt-1 text-[#2B59FF] font-semibold">24x7 Helpline: +91 (080) 6192 4000</li>
              <li>OPD Hours: Mon &ndash; Sat, 8:00 AM &ndash; 8:00 PM</li>
              <li className="text-[11px] text-[#6B7596]">care@doctorcare.i-bnb.com</li>
            </ul>
          </div>

          {/* Col 4: Patient Trust & Fair Billing */}
          <div className="space-y-2.5">
            <span className="text-xs font-bold text-[#0B1533] uppercase tracking-wider font-mono">
              Patient Trust &amp; Billing
            </span>
            <div className="space-y-2">
              <div className="text-xs p-2.5 rounded-xl bg-[#F4F6FB] border border-[#0B1533]/[0.06]">
                <span className="font-semibold text-[#15803D] block">0% GST on Consultations</span>
                <span className="text-[10px] text-[#6B7596]">Exempt clinical healthcare service under Indian law.</span>
              </div>
              <div className="text-xs p-2.5 rounded-xl bg-[#F4F6FB] border border-[#0B1533]/[0.06]">
                <span className="font-semibold text-[#2B59FF] block">10-Minute Hold Guarantee</span>
                <span className="text-[10px] text-[#6B7596]">Never double-booked. Your slot is held while you confirm.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-[#0B1533]/[0.06] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs text-[#6B7596]">
          <div>
            &copy; 2026 DoctorCare Super-Specialty Hospital, Bengaluru. All rights reserved. Clinical consultations are 0% GST exempt.
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="flex items-center gap-1.5 text-[#15803D] font-medium">
              <span className="h-2 w-2 rounded-full bg-[#15803D] animate-ping" />
              <span>Campus Operational &bull; Emergency Open 24x7</span>
            </span>
            <span>&bull;</span>
            <span>DPDP Act 2023 Patient Privacy Protected</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
