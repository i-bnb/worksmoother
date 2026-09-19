'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === '/';

  if (isHome) {
    return (
      <main className="w-full min-h-screen bg-[#F4F6FB] text-[#0B1533]">
        {children}
      </main>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[#F4F6FB] text-[#0B1533] selection:bg-blue-500/30 selection:text-blue-900">
      <Navbar />
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
        {children}
      </main>
      <Footer />
    </div>
  );
}
