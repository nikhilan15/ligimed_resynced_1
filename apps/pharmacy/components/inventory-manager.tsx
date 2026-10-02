'use client';

import {
  inventoryAdjustmentInputSchema,
  inventoryBatchInputSchema,
  inventoryThresholdInputSchema,
  type PharmacyInventory,
} from '@ligimed/validation';
import { useState, type FormEvent } from 'react';

async function mutate(path: string, method: 'POST' | 'PATCH', csrfToken: string, body: unknown) {
  const response = await fetch(`/api/inventory/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { detail?: string };
  if (!response.ok) throw new Error(result.detail ?? 'Inventory request failed.');
}

export function InventoryManager({
  inventory,
  products,
  csrfToken,
}: {
  inventory: PharmacyInventory;
  products: Array<{
    id: string;
    name: string;
    genericName: string | null;
    strength: string | null;
  }>;
  csrfToken: string;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function addBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('batch');
    setError('');
    const values = new FormData(event.currentTarget);
    const parsed = inventoryBatchInputSchema.safeParse({
      productId: values.get('productId'),
      batchNumber: values.get('batchNumber'),
      quantity: Number(values.get('quantity')),
      purchasePriceMinor: values.get('purchasePriceMinor') || null,
      manufacturedAt: values.get('manufacturedAt') || null,
      expiresAt: values.get('expiresAt'),
      reorderLevel: Number(values.get('reorderLevel')),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the batch details.');
      setBusy('');
      return;
    }
    try {
      await mutate('batches', 'POST', csrfToken, parsed.data);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add batch.');
      setBusy('');
    }
  }

  async function adjust(event: FormEvent<HTMLFormElement>, batchId: string) {
    event.preventDefault();
    setBusy(batchId);
    setError('');
    const values = new FormData(event.currentTarget);
    const parsed = inventoryAdjustmentInputSchema.safeParse({
      direction: values.get('direction'),
      quantity: Number(values.get('quantity')),
      reason: values.get('reason'),
    });
    if (!parsed.success) {
      setError('Enter a quantity and a reason.');
      setBusy('');
      return;
    }
    try {
      await mutate(`batches/${batchId}/adjustments`, 'POST', csrfToken, parsed.data);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Adjustment failed.');
      setBusy('');
    }
  }

  async function threshold(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    setBusy(itemId);
    setError('');
    const parsed = inventoryThresholdInputSchema.safeParse({
      reorderLevel: Number(new FormData(event.currentTarget).get('reorderLevel')),
    });
    if (!parsed.success) {
      setError('Enter a valid reorder level.');
      setBusy('');
      return;
    }
    try {
      await mutate(`items/${itemId}/threshold`, 'PATCH', csrfToken, parsed.data);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Threshold update failed.');
      setBusy('');
    }
  }

  return (
    <>
      {error ? <div className="commerce-error">{error}</div> : null}
      <section className="inventory-entry-card">
        <span className="section-label">RECEIVE STOCK</span>
        <h2>Add a medicine batch</h2>
        <form className="inventory-entry-form" onSubmit={(event) => void addBatch(event)}>
          <label>
            Medicine
            <select name="productId" required defaultValue="">
              <option value="" disabled>
                Select medicine
              </option>
              {products.map((product) => (
                <option value={product.id} key={product.id}>
                  {product.name}
                  {product.strength ? ` — ${product.strength}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Batch number
            <input name="batchNumber" required maxLength={100} />
          </label>
          <label>
            Quantity
            <input name="quantity" type="number" min="1" required />
          </label>
          <label>
            Purchase price (paise)
            <input name="purchasePriceMinor" inputMode="numeric" />
          </label>
          <label>
            Manufactured on
            <input name="manufacturedAt" type="date" />
          </label>
          <label>
            Expires on
            <input name="expiresAt" type="date" required />
          </label>
          <label>
            Low-stock level
            <input name="reorderLevel" type="number" min="0" defaultValue="10" required />
          </label>
          <button disabled={busy === 'batch'}>{busy === 'batch' ? 'Saving…' : 'Add batch'}</button>
        </form>
      </section>

      <div className="inventory-list">
        {inventory.items.map((item) => (
          <article className="inventory-card" key={item.id}>
            <header>
              <div>
                <h2>{item.product.name}</h2>
                <p>
                  {[item.product.genericName, item.product.strength, item.product.packSize]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="inventory-stock">
                <strong>{item.quantityOnHand}</strong>
                <span>units</span>
                {item.lowStock ? <small>Low stock</small> : null}
              </div>
            </header>
            <form className="threshold-form" onSubmit={(event) => void threshold(event, item.id)}>
              <label>
                Reorder at{' '}
                <input name="reorderLevel" type="number" min="0" defaultValue={item.reorderLevel} />
              </label>
              <button disabled={busy === item.id}>Save</button>
            </form>
            <div className="batch-table">
              {item.batches.map((batch) => (
                <div className="batch-row" key={batch.id}>
                  <div>
                    <strong>{batch.batchNumber}</strong>
                    <span>
                      Expires {new Date(`${batch.expiresAt}T00:00:00`).toLocaleDateString('en-IN')}
                    </span>
                  </div>
                  <strong>{batch.quantityOnHand} units</strong>
                  <form onSubmit={(event) => void adjust(event, batch.id)}>
                    <select name="direction">
                      <option value="OUT">Remove</option>
                      <option value="IN">Add</option>
                    </select>
                    <input name="quantity" type="number" min="1" placeholder="Qty" required />
                    <input name="reason" maxLength={500} placeholder="Reason" required />
                    <button disabled={busy === batch.id}>Adjust</button>
                  </form>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
