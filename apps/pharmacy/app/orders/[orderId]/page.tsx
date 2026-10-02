import { idSchema } from '@ligimed/validation';
import { DocumentFileActions } from '@ligimed/ui';
import '@ligimed/ui/document-styles.css';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CancelOrderButton } from '../../../components/cancel-order-button';
import { PharmacyShell } from '../../../components/pharmacy-shell';
import { readPharmacyOrder, readPharmacySession } from '../../../lib/api-server';

function money(value: string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!idSchema.safeParse(orderId).success) notFound();
  const [session, result] = await Promise.all([readPharmacySession(), readPharmacyOrder(orderId)]);
  if (!session || !result) redirect('/login');
  if (result.status === 'NOT_FOUND') notFound();
  const order = result.data;
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/orders"
    >
      <main className="marketplace-content commerce-page">
        <Link href="/orders">← All orders</Link>
        <div className="order-heading">
          <div>
            <span className="section-label">{order.status.replaceAll('_', ' ')}</span>
            <h1>{order.orderNumber}</h1>
            <p>Dealer: {order.dealer.name}</p>
          </div>
          {order.status === 'PENDING' ? (
            <CancelOrderButton orderId={order.id} csrfToken={session.csrfToken} />
          ) : null}
        </div>
        <section className="order-detail-card">
          <h2>Order documents</h2>
          <p>
            <Link href={`/documents?orderId=${order.id}`}>
              Open linked invoices, payment records and uploaded evidence →
            </Link>
          </p>
          <DocumentFileActions
            url={`/api/documents/order/${order.id}/content`}
            filename={`order-${order.orderNumber}.pdf`}
          />
        </section>
        <section className="order-detail-card">
          <h2>Payment and totals</h2>
          <p>
            {order.paymentMethod.replaceAll('_', ' ')} · {order.paymentStatus}
          </p>
          <div className="order-line">
            <span>Subtotal</span>
            <strong>{money(order.subtotal.amountMinor)}</strong>
          </div>
          <div className="order-line">
            <span>Tax</span>
            <strong>{money(order.tax.amountMinor)}</strong>
          </div>
          <div className="order-line">
            <span>Delivery</span>
            <strong>{money(order.deliveryCharge.amountMinor)}</strong>
          </div>
        </section>
        <section className="order-detail-card">
          <h2>Medicines</h2>
          {order.items.map((item) => (
            <div className="order-line" key={item.productId}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.quantity} × {money(item.unitPrice.amountMinor)}
                </span>
              </div>
              <strong>{money(item.lineTotal.amountMinor)}</strong>
            </div>
          ))}
          <div className="order-total">
            <span>Total</span>
            <strong>{money(order.total.amountMinor)}</strong>
          </div>
        </section>
        <section className="order-detail-card">
          <h2>Delivery address</h2>
          <p>
            {order.shippingAddress.name}
            <br />
            {order.shippingAddress.line1}
            {order.shippingAddress.line2 ? (
              <>
                <br />
                {order.shippingAddress.line2}
              </>
            ) : null}
            <br />
            {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
            {order.shippingAddress.postalCode}
          </p>
        </section>
        <section className="order-detail-card">
          <h2>Status history</h2>
          <ol className="status-history">
            {order.statusHistory.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.toStatus.replaceAll('_', ' ')}</strong>
                <span>{new Date(entry.createdAt).toLocaleString('en-IN')}</span>
                {entry.note ? <p>{entry.note}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </PharmacyShell>
  );
}
