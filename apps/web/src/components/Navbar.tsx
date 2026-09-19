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
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';

export function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuth();

  const navLinks = [
    { name: 'Overview', href: '/', icon: Activity },
    { name: 'Doctors', href: '/directory', icon: Stethoscope },
    { name: 'Slot Booking', href: '/booking', icon: Calendar },
    { name: 'Medical Vault', href: '/records', icon: Lock },
    { name: 'DPDP Consent', href: '/consent', icon: FileText },
  ];

  return (
    <header className="sticky top-3 z-50 w-full px-4 pt-3 pb-2">
      <div className="mx-auto max-w-7xl">
        <nav className="flex items-center justify-between rounded-full bg-white/85 px-5 py-2.5 backdrop-blur-2xl border border-[#0B1533]/[0.08] shadow-lg shadow-[#0B1533]/5 transition-all">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[#2B59FF] text-white shadow-sm transition-transform group-hover:scale-105">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-sm tracking-tight text-[#0B1533] flex items-center gap-1.5">
                DoctorCare
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-full bg-[#E9EEFE] text-[#2B59FF] border border-[#2B59FF]/20 font-bold">
                  Cloudflare Pro
                </span>
              </span>
              <span className="text-[11px] text-[#6B7596] font-medium">Healthcare Zero-Trust</span>
            </div>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-1 bg-[#F4F6FB] px-2 py-1 rounded-full border border-[#0B1533]/[0.05]">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-white text-[#2B59FF] shadow-sm border border-[#0B1533]/[0.06]'
                      : 'text-[#4A5578] hover:text-[#0B1533] hover:bg-white/60'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      isActive ? 'text-[#2B59FF]' : 'text-[#6B7596]'
                    }`}
                  />
                  {link.name}
                </Link>
              );
            })}
          </div>

          {/* Right Section: Security Badge & Action */}
          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8F7EE] border border-[#15803D]/25 text-[11px] font-mono font-bold text-[#15803D]">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>4-LAYER WAF ACTIVE</span>
            </div>

            {isAuthenticated && user ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E8F7EE] border border-[#15803D]/30 text-[#15803D] text-xs font-semibold hover:bg-emerald-100/60 transition-all shadow-sm"
                >
                  <span className="h-2 w-2 rounded-full bg-[#15803D] animate-ping" />
                  <span className="truncate max-w-[120px]">{user.name.split(' ')[0]}</span>
                  <span className="text-[10px] font-mono text-[#15803D]/80 border-l border-[#15803D]/20 pl-1.5">
                    In-Memory
                  </span>
                </Link>
                <button
                  onClick={() => logout()}
                  title="Sign Out"
                  className="p-1.5 px-2.5 rounded-full hover:bg-zinc-100 text-[#6B7596] hover:text-[#0B1533] transition-all text-xs font-medium cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-full bg-[#2B59FF] hover:bg-[#1E45D9] text-white px-4 py-1.5 text-xs font-bold transition-all shadow-md shadow-blue-500/20"
              >
                <UserCheck className="h-3.5 w-3.5" />
                <span>Staff Portal</span>
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
