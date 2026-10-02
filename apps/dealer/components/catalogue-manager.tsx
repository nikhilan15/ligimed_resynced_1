'use client';

import {
  dealerCatalogueListingInputSchema,
  dealerCatalogueListingUpdateSchema,
  type DealerCatalogueItem,
} from '@ligimed/validation';
import { useState, type FormEvent } from 'react';

function toMinor(value: string): string | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return (BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')).toString();
}

function toMajor(value: string): string {
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}

function textValue(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === 'string' ? value : '';
}

async function catalogueRequest(
  path: string,
  csrfToken: string,
  method: 'POST' | 'PATCH',
  body: unknown,
) {
  const response = await fetch(`/api/catalogue/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { detail?: string };
  if (!response.ok) throw new Error(result.detail ?? 'Catalogue request failed.');
  return result;
}

export function CatalogueManager({
  csrfToken,
  products,
}: {
  csrfToken: string;
  products: DealerCatalogueItem[];
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function createListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    setBusy('create');
    setError('');
    setMessage('');
    const form = new FormData(target);
    const unitPriceMinor = toMinor(textValue(form, 'unitPrice'));
    const parsed = dealerCatalogueListingInputSchema.safeParse({
      name: form.get('name'),
      genericName: form.get('genericName'),
      strength: form.get('strength'),
      dosageForm: form.get('dosageForm'),
      packSize: form.get('packSize'),
      description: form.get('description'),
      manufacturerName: form.get('manufacturerName'),
      categoryName: form.get('categoryName'),
      sku: form.get('sku'),
      unitPriceMinor,
      currency: 'INR',
      minimumQuantity: Number(form.get('minimumQuantity')),
      isAvailable: form.get('isAvailable') === 'on',
    });
    if (!parsed.success) {
      setError('Check the medicine details, price and minimum quantity.');
      setBusy('');
      return;
    }
    try {
      await catalogueRequest('listings', csrfToken, 'POST', parsed.data);
      setMessage('Medicine listing published.');
      target.reset();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Catalogue request failed.');
      setBusy('');
    }
  }

  async function updateListing(event: FormEvent<HTMLFormElement>, product: DealerCatalogueItem) {
    event.preventDefault();
    setBusy(product.listingId);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const unitPriceMinor = toMinor(textValue(form, 'unitPrice'));
    const parsed = dealerCatalogueListingUpdateSchema.safeParse({
      sku: form.get('sku'),
      unitPriceMinor,
      currency: 'INR',
      minimumQuantity: Number(form.get('minimumQuantity')),
      isAvailable: form.get('isAvailable') === 'on',
    });
    if (!parsed.success) {
      setError('Check the listing price and minimum quantity.');
      setBusy('');
      return;
    }
    try {
      await catalogueRequest(`listings/${product.listingId}`, csrfToken, 'PATCH', parsed.data);
      setMessage(`${product.name} updated.`);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Catalogue request failed.');
      setBusy('');
    }
  }

  return (
    <>
      {error ? <div className="alert error">{error}</div> : null}
      {message ? <div className="alert success">{message}</div> : null}
      <section className="panel">
        <h2>Publish a medicine</h2>
        <p>
          Add verified commercial information only. Regulatory classification and sale restrictions
          require qualified compliance review.
        </p>
        <form className="form-grid catalogue-form" onSubmit={(event) => void createListing(event)}>
          <label>
            Medicine name
            <input name="name" minLength={2} maxLength={250} required />
          </label>
          <label>
            Generic name
            <input name="genericName" maxLength={250} />
          </label>
          <label>
            Manufacturer
            <input name="manufacturerName" maxLength={250} />
          </label>
          <label>
            Category
            <input name="categoryName" maxLength={150} />
          </label>
          <label>
            Strength
            <input name="strength" maxLength={100} placeholder="500 mg" />
          </label>
          <label>
            Dosage form
            <input name="dosageForm" maxLength={100} placeholder="Tablet" />
          </label>
          <label>
            Pack size
            <input name="packSize" maxLength={100} placeholder="10 tablets" />
          </label>
          <label>
            SKU
            <input name="sku" maxLength={100} />
          </label>
          <label>
            Unit price (INR)
            <input name="unitPrice" inputMode="decimal" pattern="\d+(\.\d{1,2})?" required />
          </label>
          <label>
            Minimum quantity
            <input
              name="minimumQuantity"
              type="number"
              min={1}
              max={1_000_000}
              defaultValue={1}
              required
            />
          </label>
          <label className="wide">
            Medicine description
            <textarea name="description" maxLength={2000} rows={4} />
          </label>
          <label className="checkbox wide">
            <input name="isAvailable" type="checkbox" defaultChecked /> Publish immediately
          </label>
          <button className="wide" disabled={busy === 'create'}>
            {busy === 'create' ? 'Publishing…' : 'Publish medicine'}
          </button>
        </form>
      </section>

      <section className="catalogue-list">
        <div className="catalogue-list-heading">
          <h2>Catalogue listings</h2>
          <span>{products.length} shown</span>
        </div>
        {products.length ? (
          products.map((product) => (
            <form
              className="catalogue-listing"
              key={product.listingId}
              onSubmit={(event) => void updateListing(event, product)}
            >
              <div>
                <span className="eyebrow">{product.category ?? 'MEDICINE'}</span>
                <h3>{product.name}</h3>
                <p>
                  {[product.genericName, product.strength, product.dosageForm, product.packSize]
                    .filter(Boolean)
                    .join(' · ') || 'No additional medicine attributes'}
                </p>
              </div>
              <label>
                SKU
                <input name="sku" defaultValue={product.sku ?? ''} maxLength={100} />
              </label>
              <label>
                Price (INR)
                <input
                  name="unitPrice"
                  defaultValue={toMajor(product.unitPrice.amountMinor)}
                  inputMode="decimal"
                  pattern="\d+(\.\d{1,2})?"
                  required
                />
              </label>
              <label>
                Minimum quantity
                <input
                  name="minimumQuantity"
                  type="number"
                  min={1}
                  max={1_000_000}
                  defaultValue={product.minimumQuantity}
                  required
                />
              </label>
              <label className="checkbox">
                <input name="isAvailable" type="checkbox" defaultChecked={product.isAvailable} />
                Published
              </label>
              <button disabled={busy === product.listingId}>
                {busy === product.listingId ? 'Saving…' : 'Save listing'}
              </button>
            </form>
          ))
        ) : (
          <div className="panel">
            <h3>No catalogue listings yet</h3>
            <p>Publish the first medicine using the form above.</p>
          </div>
        )}
      </section>
    </>
  );
}
