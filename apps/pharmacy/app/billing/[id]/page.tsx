import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { idSchema } from '@ligimed/validation';
import { DocumentFileActions } from '@ligimed/ui';
import '@ligimed/ui/document-styles.css';

import { PharmacyShell } from '../../../components/pharmacy-shell';
import { PaymentLedger } from '../../../components/payment-ledger';
import { PrintRecordButton } from '../../../components/print-record-button';
import { readPharmacyInvoice, readPharmacySession } from '../../../lib/api-server';

function money(value: string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export default async function BillingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const session = await readPharmacySession();
  if (!session) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  const result = await readPharmacyInvoice(id);
  if (!result || result.status === 'NOT_FOUND') notFound();
  const invoice = result.data;
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/billing"
    >
      <main className="marketplace-content billing-page">
        <Link className="billing-back" href="/billing">
          ← Back to billing
        </Link>
        <span className="section-label">
          {invoice.type === 'RETAIL_SALE' ? 'RETAIL SALE RECORD' : 'DEALER PURCHASE RECORD'}
        </span>
        <h1>{invoice.referenceNumber}</h1>
        <p>
          Recorded for {invoice.counterpartyName} on{' '}
          {new Intl.DateTimeFormat('en-IN', { dateStyle: 'long' }).format(
            new Date(invoice.recordedAt),
          )}
          .
        </p>
        <div className="billing-caution" role="note">
          Internal operational record only. This page is not a statutory tax invoice or proof of
          payment.
        </div>
        <div className="billing-detail-actions">
          <PrintRecordButton />
          <DocumentFileActions
            url={`/api/documents/invoice/${invoice.id}/content`}
            filename={`bill-${invoice.referenceNumber}.pdf`}
          />
          <Link href={`/documents?invoiceId=${invoice.id}`}>Linked documents →</Link>
          <Link href="/billing">New bill →</Link>
        </div>
        <section className="billing-detail-card">
          <div className="billing-detail-meta">
            <div>
              <span>Type</span>
              <strong>
                {invoice.type === 'RETAIL_SALE' ? 'Customer sale' : 'Dealer purchase'}
              </strong>
            </div>
            <div>
              <span>Counterparty</span>
              <strong>{invoice.counterpartyName}</strong>
            </div>
            {invoice.orderNumber ? (
              <div>
                <span>Linked order</span>
                <strong>{invoice.orderNumber}</strong>
              </div>
            ) : null}
            {invoice.issuedAt ? (
              <div>
                <span>Dealer issue date</span>
                <strong>{invoice.issuedAt}</strong>
              </div>
            ) : null}
            <div>
              <span>Reconciliation</span>
              <strong>{invoice.reconciliation.replaceAll('_', ' ').toLowerCase()}</strong>
            </div>
          </div>
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch</th>
                  <th>Quantity</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.type === 'RETAIL_SALE'
                  ? invoice.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.productName}</td>
                        <td>{line.batchNumber}</td>
                        <td>{line.quantity}</td>
                        <td>{money(line.total.amountMinor)}</td>
                      </tr>
                    ))
                  : invoice.orderItems.map((item, index) => (
                      <tr key={`${item.productName}-${index}`}>
                        <td>{item.productName}</td>
                        <td>Order snapshot</td>
                        <td>{item.quantity}</td>
                        <td>{money(item.lineTotal.amountMinor)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          <dl className="billing-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(invoice.subtotal.amountMinor)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>− {money(invoice.discount.amountMinor)}</dd>
            </div>
            <div>
              <dt>Tax recorded</dt>
              <dd>{money(invoice.tax.amountMinor)}</dd>
            </div>
            <div>
              <dt>Delivery charge</dt>
              <dd>{money(invoice.deliveryCharge.amountMinor)}</dd>
            </div>
            <div className="billing-grand-total">
              <dt>Total recorded</dt>
              <dd>{money(invoice.total.amountMinor)}</dd>
            </div>
          </dl>
        </section>
        <PaymentLedger invoice={invoice} csrfToken={session.csrfToken} />
      </main>
    </PharmacyShell>
  );
}
