import Link from 'next/link';
import { redirect } from 'next/navigation';
import { idSchema } from '@ligimed/validation';

import { PharmacyShell } from '../../../components/pharmacy-shell';
import { readPharmacyInvoices, readPharmacySession } from '../../../lib/api-server';

function money(value: string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; cursor?: string }>;
}) {
  const query = await searchParams;
  const type =
    query.type === 'RETAIL_SALE' || query.type === 'DEALER_PURCHASE' ? query.type : undefined;
  const cursor = idSchema.safeParse(query.cursor).success ? query.cursor : undefined;
  const session = await readPharmacySession();
  if (!session) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  const invoices = await readPharmacyInvoices({
    ...(type ? { type } : {}),
    ...(cursor ? { cursor } : {}),
  });
  if (!invoices) throw new Error('Billing records are unavailable.');
  const next = new URLSearchParams();
  if (type) next.set('type', type);
  if (invoices.page.nextCursor) next.set('cursor', invoices.page.nextCursor);

  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/billing"
    >
      <main className="marketplace-content billing-page">
        <span className="section-label">PHARMACY BILLING</span>
        <h1>Billing history</h1>
        <p>Record customer sales and dealer purchase invoices in separate ledgers.</p>
        <div className="billing-caution" role="note">
          These are internal operational records, not compliant tax invoices. Confirm tax amounts
          and statutory invoice requirements with your accountant before external use. Recording a
          sale reduces stock; recording a dealer invoice does not make it payable or paid.
        </div>
        <p>
          <Link href="/billing">← New retail bill</Link> ·{' '}
          <Link href="/billing/purchases">Record dealer purchase</Link>
        </p>
        <section className="billing-ledger">
          <div className="billing-ledger-heading">
            <h2>Recorded activity</h2>
            <nav aria-label="Filter billing records">
              <Link className={!type ? 'selected' : ''} href="/billing/history">
                All
              </Link>
              <Link
                className={type === 'RETAIL_SALE' ? 'selected' : ''}
                href="/billing/history?type=RETAIL_SALE"
              >
                Retail sales
              </Link>
              <Link
                className={type === 'DEALER_PURCHASE' ? 'selected' : ''}
                href="/billing/history?type=DEALER_PURCHASE"
              >
                Dealer purchases
              </Link>
            </nav>
          </div>
          {invoices.invoices.length ? (
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Type</th>
                    <th>Customer / dealer</th>
                    <th>Recorded</th>
                    <th>Status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <Link href={`/billing/${invoice.id}`}>{invoice.referenceNumber}</Link>
                      </td>
                      <td>{invoice.type === 'RETAIL_SALE' ? 'Retail sale' : 'Dealer purchase'}</td>
                      <td>{invoice.counterpartyName}</td>
                      <td>
                        {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(
                          new Date(invoice.recordedAt),
                        )}
                      </td>
                      <td>{invoice.reconciliation.replaceAll('_', ' ').toLowerCase()}</td>
                      <td>
                        <strong>{money(invoice.total.amountMinor)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="billing-empty">No billing records yet.</div>
          )}
          {invoices.page.hasMore ? (
            <Link className="customers-more" href={`/billing/history?${next}`}>
              Show more →
            </Link>
          ) : null}
        </section>
      </main>
    </PharmacyShell>
  );
}
