import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './operational.css';
export const metadata: Metadata = {
  title: 'LigiMed Admin',
  description: 'Privileged LigiMed operations',
};
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
