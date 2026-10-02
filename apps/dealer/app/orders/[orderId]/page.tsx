import { idSchema } from '@ligimed/validation';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DealerHeader } from '../../../components/dealer-header';
import { OrderStatusForm } from '../../../components/order-status-form';
import { readDealerOrder, readDealerSession } from '../../../lib/api-server';

function money(value: string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export default async function DealerOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!idSchema.safeParse(orderId).success) notFound();
  const [session, order] = await Promise.all([readDealerSession(), readDealerOrder(orderId)]);
  if (!session) redirect('/login');
  if (!order) notFound();
  return (
    <>
      <DealerHeader name={session.dealer.name} csrfToken={session.csrfToken} />
      <main className="catalogue-page order-page">
        <Link href="/orders">← All orders</Link>
        <span className="eyebrow">{order.status.replaceAll('_', ' ')}</span>
        <h1>{order.orderNumber}</h1>
        <p>Pharmacy: {order.pharmacy.name}</p>
        <OrderStatusForm orderId={order.id} status={order.status} csrfToken={session.csrfToken} />
        <section className="panel">
          <h2>Medicines</h2>
          {order.items.map((item) => (
            <div className="dealer-order-line" key={item.productId}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.quantity} × {money(item.unitPrice.amountMinor)}
                </span>
              </div>
              <strong>{money(item.lineTotal.amountMinor)}</strong>
            </div>
          ))}
          <div className="dealer-order-total">
            <span>Total</span>
            <strong>{money(order.total.amountMinor)}</strong>
          </div>
        </section>
        <section className="panel">
          <h2>Payment</h2>
          <p>
            {order.paymentMethod.replaceAll('_', ' ')} · {order.paymentStatus}
          </p>
          <div className="dealer-order-line">
            <span>Subtotal</span>
            <strong>{money(order.subtotal.amountMinor)}</strong>
          </div>
          <div className="dealer-order-line">
            <span>Tax</span>
            <strong>{money(order.tax.amountMinor)}</strong>
          </div>
          <div className="dealer-order-line">
            <span>Delivery</span>
            <strong>{money(order.deliveryCharge.amountMinor)}</strong>
          </div>
        </section>
        <section className="panel">
          <h2>Delivery address</h2>
          <p>
            {order.shippingAddress.name}
            <br />
            {order.shippingAddress.line1}
            <br />
            {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
            {order.shippingAddress.postalCode}
          </p>
        </section>
        <section className="panel">
          <h2>Status history</h2>
          <ol className="dealer-status-history">
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
    </>
  );
}
