import type { ReactNode } from 'react';
import Link from 'next/link';

import { Brand } from './brand';
import { LogoutButton } from './logout-button';

const navigation = [
  ['Dashboard', '/dashboard', false],
  ['Marketplace', '/marketplace', false],
  ['Cart', '/cart', false],
  ['Orders', '/orders', false],
  ['Inventory', '/inventory', false],
  ['Billing', '/billing', false],
  ['Customers', '/customers', false],
  ['Documents', '/documents', false],
  ['Payments', '', true],
  ['Notifications', '', true],
  ['Profile', '/account', false],
  ['Settings', '', true],
  ['Support', '', true],
] as const;

export function PharmacyShell({
  pharmacyName,
  csrfToken,
  activePath,
  children,
}: {
  pharmacyName: string;
  csrfToken: string;
  activePath:
    | '/dashboard'
    | '/marketplace'
    | '/cart'
    | '/orders'
    | '/inventory'
    | '/billing'
    | '/customers'
    | '/documents'
    | '/account';
  children: ReactNode;
}) {
  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <Brand />
        <div className="portal-organization">
          <span>PHARMACY</span>
          <strong>{pharmacyName}</strong>
        </div>
        <nav aria-label="Pharmacy workspace">
          {navigation.map(([label, href, disabled]) =>
            disabled ? (
              <span className="portal-nav-item disabled" key={label} aria-disabled="true">
                <span className="portal-nav-label">{label}</span> <small>Soon</small>
              </span>
            ) : (
              <Link
                className={`portal-nav-item${activePath === href ? ' active' : ''}`}
                href={href}
                key={label}
                aria-current={activePath === href ? 'page' : undefined}
              >
                <span className="portal-nav-label">{label}</span>
              </Link>
            ),
          )}
        </nav>
        <span className="portal-profile-link">Protected pharmacy access</span>
      </aside>
      <div className="portal-main">
        <header className="portal-topbar">
          <div className="portal-workspace-title">
            <span>PHARMACY WORKSPACE</span>
            <strong>{pharmacyName}</strong>
          </div>
          <LogoutButton csrfToken={csrfToken} />
        </header>
        {children}
      </div>
    </div>
  );
}
