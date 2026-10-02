import { commerceOrderQuerySchema, orderStatuses } from '@ligimed/validation';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DealerHeader } from '../../components/dealer-header';
import { readDealerOrders, readDealerSession } from '../../lib/api-server';

function money(value: string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export default async function DealerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const parsed = commerceOrderQuerySchema.safeParse({ ...(await searchParams), limit: 20 });
  if (!parsed.success) notFound();
  const [session, orders] = await Promise.all([readDealerSession(), readDealerOrders(parsed.data)]);
  if (!session || !orders) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  return (
    <>
      <DealerHeader name={session.dealer.name} csrfToken={session.csrfToken} />
      <main className="catalogue-page order-page">
        <span className="eyebrow">DEALER ORDERS</span>
        <h1>Incoming pharmacy orders</h1>
        <form className="catalogue-search" method="get">
          <label>
            Status
            <select name="status" defaultValue={parsed.data.status ?? ''}>
              <option value="">All statuses</option>
              {orderStatuses.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <button>Filter</button>
        </form>
        <div className="dealer-order-list">
          {orders.orders.map((order) => (
            <Link href={`/orders/${order.id}`} className="dealer-order-card" key={order.id}>
              <div>
                <strong>{order.orderNumber}</strong>
                <span>{order.pharmacy.name}</span>
              </div>
              <div>
                <span>{order.status.replaceAll('_', ' ')}</span>
                <strong>{money(order.total.amountMinor)}</strong>
              </div>
            </Link>
          ))}
        </div>
        {orders.orders.length === 0 ? <section className="panel">No orders found.</section> : null}
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
    </>
  );
}
