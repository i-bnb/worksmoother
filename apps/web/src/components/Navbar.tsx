'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  ShieldCheck,
  Calendar,
  Lock,
  FileText,
  UserCheck,
  Stethoscope,
  Sparkles,
} from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();

  const navLinks = [
    { name: 'Overview', href: '/', icon: Activity },
    { name: 'Doctors', href: '/directory', icon: Stethoscope },
    { name: 'Slot Booking', href: '/booking', icon: Calendar },
    { name: 'Medical Vault', href: '/records', icon: Lock },
    { name: 'DPDP Consent', href: '/consent', icon: FileText },
  ];

  return (
    <header className="sticky top-0 z-50 w-full px-4 pt-4 pb-2">
      <div className="mx-auto max-w-7xl">
        <nav className="flex items-center justify-between rounded-full bg-black/60 px-5 py-3 backdrop-blur-2xl border border-white/10 shadow-2xl transition-all">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-green-500/20 border border-white/15 group-hover:border-white/30 transition-all">
              <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
              <div className="absolute -inset-0.5 rounded-full bg-emerald-500/20 blur-sm opacity-50 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm tracking-tight text-white flex items-center gap-1.5">
                DoctorCare
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/70 border border-white/10">
                  Cloudflare Pro
                </span>
              </span>
              <span className="text-[11px] text-zinc-400 font-normal">Healthcare Zero-Trust</span>
            </div>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-1 bg-white/[0.03] px-2 py-1 rounded-full border border-white/5">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-white/15 text-white shadow-sm border border-white/15'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-blue-400' : 'text-zinc-400'}`} />
                  {link.name}
                </Link>
              );
            })}
          </div>

          {/* Right Section: Security Badge & Action */}
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[11px] font-mono text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>4-LAYER WAF ACTIVE</span>
            </div>

            <Link
              href="/records"
              className="flex items-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 text-xs font-medium transition-all shadow-lg shadow-blue-500/25 border border-blue-400/30"
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>Staff Portal</span>
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
