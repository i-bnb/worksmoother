import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'DoctorCare | Zero-Trust Healthcare Platform',
  description:
    'Enterprise healthcare infrastructure built on Cloudflare Workers, Cloudflare Secrets Store, and Appwrite Cloud dual-project isolation.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-black text-zinc-100 selection:bg-blue-500/30 selection:text-blue-200">
        <div className="relative flex min-h-screen flex-col">
          <Navbar />
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
