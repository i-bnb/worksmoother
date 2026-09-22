import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientShell } from '@/components/ClientShell';
import { AuthProvider } from '@/context/AuthContext';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: 'DoctorCare Hospital | Multi-Specialty Healthcare & Digital Clinic, Bengaluru',
  description:
    'DoctorCare Super-Specialty Hospital, Bengaluru. Book senior specialist doctor consultations, access 100% confidential health records, and experience compassionate on-time care.',
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
