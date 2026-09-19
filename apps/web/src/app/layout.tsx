import type { Metadata } from 'next';
import './globals.css';
import { ClientShell } from '@/components/ClientShell';
import { AuthProvider } from '@/context/AuthContext';

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
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          <ClientShell>{children}</ClientShell>
        </AuthProvider>
      </body>
    </html>
  );
}
