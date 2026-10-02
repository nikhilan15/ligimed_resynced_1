import { commerceOrderQuerySchema, orderStatuses } from '@ligimed/validation';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PharmacyShell } from '../../components/pharmacy-shell';
import { readPharmacyOrders, readPharmacySession } from '../../lib/api-server';

function money(value: string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const parsed = commerceOrderQuerySchema.safeParse({ ...(await searchParams), limit: 20 });
  if (!parsed.success) notFound();
  const [session, orders] = await Promise.all([
    readPharmacySession(),
    readPharmacyOrders(parsed.data),
  ]);
  if (!session || !orders) redirect('/login');
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/orders"
    >
      <main className="marketplace-content commerce-page">
        <span className="section-label">PURCHASE ORDERS</span>
        <h1>Orders and status history</h1>
        <form className="order-filter" method="get">
          <select name="status" defaultValue={parsed.data.status ?? ''} aria-label="Order status">
            <option value="">All statuses</option>
            {orderStatuses.map((status) => (
              <option value={status} key={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <button>Filter</button>
        </form>
        <div className="order-list">
          {orders.orders.map((order) => (
            <Link className="order-card" href={`/orders/${order.id}`} key={order.id}>
              <div>
                <strong>{order.orderNumber}</strong>
                <span>{order.dealer.name}</span>
              </div>
              <div>
                <span>{order.status.replaceAll('_', ' ')}</span>
                <strong>{money(order.total.amountMinor)}</strong>
              </div>
            </Link>
          ))}
        </div>
        {orders.orders.length === 0 ? <div className="commerce-empty">No orders found.</div> : null}
        {orders.page.nextCursor ? (
          <Link
            href={{
              pathname: '/orders',
              query: {
                ...(parsed.data.status ? { status: parsed.data.status } : {}),
                cursor: orders.page.nextCursor,
              },
            }}
          >
            More orders →
          </Link>
        ) : null}
      </main>
    </PharmacyShell>
  );
}
