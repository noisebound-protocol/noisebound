import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'noisebound wallet',
  description: 'Post-quantum wallet — create, view balance, and send on Base',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}