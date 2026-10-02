import { redirect } from 'next/navigation';

import { InventoryManager } from '../../components/inventory-manager';
import { PharmacyShell } from '../../components/pharmacy-shell';
import {
  readInventoryProducts,
  readPharmacyInventory,
  readPharmacySession,
} from '../../lib/api-server';

function money(amountMinor: string) {
  const minor = BigInt(amountMinor);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const query = await searchParams;
  const [session, inventory, products] = await Promise.all([
    readPharmacySession(),
    readPharmacyInventory(query),
    readInventoryProducts(query.q),
  ]);
  if (!session || !inventory || !products) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/inventory"
    >
      <main className="marketplace-content inventory-page">
        <span className="section-label">PHARMACY INVENTORY</span>
        <h1>Stock, batches and expiry</h1>
        <p>
          Track on-hand stock by batch. Expiry dates and low-stock thresholds are enforced from
          persisted records.
        </p>
        <section className="inventory-summary">
          <article>
            <span>Products</span>
            <strong>{inventory.summary.products}</strong>
          </article>
          <article>
            <span>Units</span>
            <strong>{inventory.summary.units}</strong>
          </article>
          <article>
            <span>Low stock</span>
            <strong>{inventory.summary.lowStock}</strong>
          </article>
          <article>
            <span>Near expiry</span>
            <strong>{inventory.summary.nearExpiry}</strong>
          </article>
          <article>
            <span>Expired</span>
            <strong>{inventory.summary.expired}</strong>
          </article>
          <article>
            <span>Stock value</span>
            <strong>{money(inventory.summary.inventoryValue.amountMinor)}</strong>
          </article>
        </section>
        <form className="inventory-filters">
          <input name="q" defaultValue={query.q} placeholder="Search medicine or generic name" />
          <select name="status" defaultValue={query.status ?? 'ALL'}>
            <option value="ALL">All stock</option>
            <option value="LOW_STOCK">Low stock</option>
            <option value="NEAR_EXPIRY">Near expiry</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <button>Filter</button>
        </form>
        <InventoryManager
          inventory={inventory}
          products={products.products}
          csrfToken={session.csrfToken}
        />
      </main>
    </PharmacyShell>
  );
}
