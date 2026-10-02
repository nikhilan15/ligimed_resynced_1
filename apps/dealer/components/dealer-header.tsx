'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export function DealerHeader({ name, csrfToken }: { name: string; csrfToken: string }) {
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const links = [
    ['Overview', '/account'],
    ['Verification', '/onboarding'],
    ['Catalogue', '/catalogue'],
    ['Orders', '/orders'],
  ] as const;
  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: '{}',
      });
      if (!response.ok) throw new Error('Sign out failed');
      window.location.replace('/login');
    } catch {
      setBusy(false);
    }
  }
  return (
    <header className="dealer-header">
      <Link href="/account" className="brand dealer-brand">
        <b className="dealer-brand-mark">+</b>
        <span>
          LigiMed <small>DEALER</small>
        </span>
      </Link>
      <nav>
        {links.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname.startsWith(href) ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <span className="dealer-identity">
        <i>{name.slice(0, 1).toUpperCase()}</i>
        <span>
          <small>ACTIVE DEALER</small>
          {name}
        </span>
      </span>
      <button type="button" disabled={busy} onClick={() => void signOut()}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </header>
  );
}
