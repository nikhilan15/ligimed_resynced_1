import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CartManager } from '../../components/cart-manager';
import { PharmacyShell } from '../../components/pharmacy-shell';
import { readPharmacyCart, readPharmacySession } from '../../lib/api-server';

export default async function CartPage() {
  const [session, result] = await Promise.all([readPharmacySession(), readPharmacyCart()]);
  if (!session || !result) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/cart"
    >
      <main className="marketplace-content commerce-page">
        <span className="section-label">PURCHASE CART</span>
        <h1>{result.cart ? `Order from ${result.cart.dealer.name}` : 'Your cart is empty'}</h1>
        {result.cart ? (
          <CartManager cart={result.cart} csrfToken={session.csrfToken} />
        ) : (
          <section className="commerce-empty">
            <p>Choose an available medicine from a verified dealer to begin an order.</p>
            <Link className="marketplace-next" href="/marketplace">
              Browse marketplace →
            </Link>
          </section>
        )}
      </main>
    </PharmacyShell>
  );
}
