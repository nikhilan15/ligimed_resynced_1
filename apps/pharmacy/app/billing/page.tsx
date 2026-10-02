import { redirect } from 'next/navigation';

import { PharmacyShell } from '../../components/pharmacy-shell';
import { RetailPos } from '../../components/retail-pos';
import { readPharmacyInvoices, readPharmacySession } from '../../lib/api-server';
import './pos.css';

export default async function BillingPage() {
  const session = await readPharmacySession();
  if (!session) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  const recent = await readPharmacyInvoices({ type: 'RETAIL_SALE' });
  if (!recent) throw new Error('Billing records are unavailable.');
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/billing"
    >
      <RetailPos csrfToken={session.csrfToken} recent={recent.invoices.slice(0, 5)} />
    </PharmacyShell>
  );
}
