import type { ReactNode } from 'react';
import Link from 'next/link';

import { AdminLogoutButton } from './admin-logout-button';

export function AdminShell({
  displayName,
  csrfToken,
  children,
  activePath = '/reviews',
}: {
  displayName: string | null;
  csrfToken: string;
  children: ReactNode;
  activePath?: '/reviews' | '/documents';
}) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/reviews">
          <b className="admin-brand-mark">+</b>
          <span>
            LigiMed<small>OPERATIONS</small>
          </span>
        </Link>
        <nav className="admin-nav" aria-label="Administration">
          <Link href="/reviews" aria-current={activePath === '/reviews' ? 'page' : undefined}>
            KYC review
          </Link>
          <Link href="/documents" aria-current={activePath === '/documents' ? 'page' : undefined}>
            Document review
          </Link>
          <span aria-disabled="true">Audit logs · Soon</span>
        </nav>
        <div className="admin-identity">
          <i>{(displayName ?? 'C').slice(0, 1).toUpperCase()}</i>
          <div>
            <small>SIGNED IN AS</small>
            <strong>{displayName ?? 'Compliance reviewer'}</strong>
          </div>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div>
            <small>SECURE OPERATIONS</small>
            <strong>Compliance control centre</strong>
          </div>
          <AdminLogoutButton csrfToken={csrfToken} />
        </header>
        {children}
      </div>
    </div>
  );
}
