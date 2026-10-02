import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BillingManager } from '../../../components/billing-manager';
import { PharmacyShell } from '../../../components/pharmacy-shell';
import { readPharmacySession } from '../../../lib/api-server';

export default async function DealerPurchaseBillingPage() {
  const session = await readPharmacySession();
  if (!session) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/billing"
    >
      <main className="marketplace-content billing-page">
        <Link href="/billing">← Retail billing</Link>
        <span className="section-label">PURCHASE RECORDS</span>
        <h1>Dealer purchase invoices</h1>
        <p>
          Record the details from an invoice actually supplied by your dealer against an eligible
          order.
        </p>
        <div className="billing-caution" role="note">
          This does not create a dealer invoice or mark it paid. Keep the original dealer document
          for reconciliation.
        </div>
        <BillingManager csrfToken={session.csrfToken} purchaseOnly />
        <p>
          <Link href="/billing/history?type=DEALER_PURCHASE">View recorded dealer invoices →</Link>
        </p>
      </main>
    </PharmacyShell>
  );
}
