'use client';

import React, { useState, useEffect } from 'react';
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
  Menu,
  X,
  ArrowRight,
  LogOut,
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';

export function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Automatically close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Prevent background scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const navLinks = [
    { name: 'Home', href: '/', icon: Activity },
    { name: 'Doctors', href: '/directory', icon: Stethoscope },
    { name: 'Book Visit', href: '/booking', icon: Calendar },
    { name: 'Health Records', href: '/records', icon: Lock },
    { name: 'Patient Privacy', href: '/consent', icon: FileText },
  ];

  return (
    <header className="sticky top-3 z-50 w-full px-3 sm:px-4 pt-3 pb-2">
      <div className="mx-auto max-w-7xl">
        <nav className="flex items-center justify-between rounded-full bg-white/90 px-4 sm:px-5 py-2 backdrop-blur-2xl border border-[#0B1533]/[0.08] shadow-lg shadow-[#0B1533]/5 transition-all">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-2.5 sm:gap-3 group py-1">
            <div className="relative flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-[#2B59FF] text-white shadow-sm transition-transform group-hover:scale-105">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-sm sm:text-base tracking-tight text-[#0B1533] flex items-center gap-1.5">
                DoctorCare
                <span className="hidden xs:inline-block text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-[#E8F7EE] text-[#15803D] border border-[#15803D]/20">
                  Bengaluru Campus
                </span>
              </span>
              <span className="text-[10px] sm:text-[11px] text-[#6B7596] font-medium">Multi-Specialty Hospital</span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-1 bg-[#F4F6FB] px-2 py-1 rounded-full border border-[#0B1533]/[0.05]">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
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

          {/* Right Section: Hospital Status Badge & Action (Desktop & Mobile) */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden lg:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E8F7EE] border border-[#15803D]/25 text-[11px] font-semibold text-[#15803D]">
              <span className="h-2 w-2 rounded-full bg-[#15803D] animate-ping" />
              <span>OPD Open Today &bull; 24x7 Emergency</span>
            </div>

            {isAuthenticated && user ? (
              <div className="hidden sm:flex items-center gap-2">
                <Link
                  href="/login"
                  className="flex items-center gap-2 px-3.5 py-2 min-h-[44px] rounded-full bg-[#E8F7EE] border border-[#15803D]/30 text-[#15803D] text-xs font-semibold hover:bg-emerald-100/60 transition-all shadow-sm"
                >
                  <span className="h-2 w-2 rounded-full bg-[#15803D]" />
                  <span className="truncate max-w-[120px]">{user.name.split(' ')[0]}</span>
                  <span className="text-[10px] font-mono text-[#15803D]/80 border-l border-[#15803D]/20 pl-1.5">
                    Verified
                  </span>
                </Link>
                <button
                  onClick={() => logout()}
                  title="Sign Out"
                  className="min-h-[44px] min-w-[44px] px-3 rounded-full hover:bg-zinc-100 text-[#6B7596] hover:text-[#0B1533] transition-all text-xs font-medium cursor-pointer flex items-center justify-center"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#2B59FF] hover:bg-[#1E45D9] text-white px-4 py-2 min-h-[44px] text-xs font-bold transition-all shadow-md shadow-blue-500/20"
              >
                <UserCheck className="h-3.5 w-3.5" />
                <span>Doctor &amp; Staff Portal</span>
              </Link>
            )}

            {/* Mobile Hamburger Button (44x44px minimum touch target) */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
              className="md:hidden flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-[#0B1533] hover:bg-[#F4F6FB] transition-colors cursor-pointer border border-[#0B1533]/[0.08]"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5 text-[#0B1533]" />
              ) : (
                <Menu className="h-5 w-5 text-[#0B1533]" />
              )}
            </button>
          </div>
        </nav>
      </div>

      {/* Mobile Drawer Overlay & Sliding Panel */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end pt-20">
          {/* Translucent Backdrop */}
          <div
            className="fixed inset-0 bg-[#0B1533]/40 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Container (Apple-inspired rounded card sheet) */}
          <div className="relative z-50 mx-3 mb-4 rounded-[28px] bg-white/95 backdrop-blur-2xl border border-[#0B1533]/10 shadow-2xl p-5 sm:p-6 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-5 animate-in slide-in-from-bottom-5 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#0B1533]/[0.08]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2B59FF]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#0B1533]">
                  Hospital Menu
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F7EE] text-[#15803D] text-[10px] font-bold">
                <ShieldCheck className="h-3 w-3" />
                <span>NABH Accredited</span>
              </span>
            </div>

            {/* Mobile Nav Links */}
            <div className="space-y-1.5">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.name}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-4 py-3 min-h-[48px] rounded-2xl text-sm font-semibold transition-all ${
                      isActive
                        ? 'bg-[#EEF2FF] text-[#2B59FF] border border-[#2B59FF]/20 shadow-sm'
                        : 'text-[#0B1533] hover:bg-[#F4F6FB] active:bg-zinc-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-xl ${
                          isActive ? 'bg-[#2B59FF] text-white' : 'bg-[#F4F6FB] text-[#6B7596]'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <span>{link.name}</span>
                    </div>
                    <ArrowRight className={`h-4 w-4 ${isActive ? 'text-[#2B59FF]' : 'text-[#6B7596]'}`} />
                  </Link>
                );
              })}
            </div>

            {/* Mobile Footer Actions */}
            <div className="pt-4 border-t border-[#0B1533]/[0.08] space-y-3">
              {isAuthenticated && user ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F4F6FB] text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-[#E8F7EE] text-[#15803D] flex items-center justify-center font-bold">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-[#0B1533]">{user.name}</div>
                        <div className="text-[#6B7596] text-[11px]">{user.email}</div>
                      </div>
                    </div>
                    <span className="text-[10px] text-[#15803D] bg-[#E8F7EE] px-2 py-0.5 rounded-full font-bold">
                      Verified
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center justify-center min-h-[44px] rounded-xl bg-[#2B59FF] text-white text-xs font-bold shadow-md shadow-blue-500/20"
                    >
                      Staff Portal
                    </Link>
                    <button
                      onClick={() => {
                        logout();
                        setMobileMenuOpen(false);
                      }}
                      className="flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl bg-[#F4F6FB] border border-[#0B1533]/[0.08] text-[#D93025] text-xs font-bold hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center gap-2 w-full py-3 min-h-[48px] rounded-2xl bg-[#2B59FF] hover:bg-[#1E45D9] text-white text-sm font-bold shadow-lg shadow-blue-500/25 transition-all"
                >
                  <UserCheck className="h-4 w-4" />
                  <span>Doctor &amp; Staff Portal</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
