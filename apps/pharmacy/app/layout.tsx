import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import './operational.css';

export const metadata: Metadata = {
  title: 'LigiMed Pharmacy',
  description: 'Secure pharmacy procurement on LigiMed',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
