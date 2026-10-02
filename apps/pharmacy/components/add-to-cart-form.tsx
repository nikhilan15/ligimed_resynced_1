'use client';

import { pharmacyCartItemInputSchema } from '@ligimed/validation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

export function AddToCartForm({
  csrfToken,
  listingId,
  minimumQuantity,
}: {
  csrfToken: string;
  listingId: string;
  minimumQuantity: number;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    const form = new FormData(event.currentTarget);
    const input = pharmacyCartItemInputSchema.safeParse({ quantity: Number(form.get('quantity')) });
    if (!input.success) {
      setError('Enter a valid quantity.');
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`/api/commerce/cart/items/${listingId}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(input.data),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? 'Could not add this medicine.');
      setMessage('Added to cart.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this medicine.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-cart-form" onSubmit={(event) => void submit(event)}>
      <label>
        Quantity
        <input
          name="quantity"
          type="number"
          min={minimumQuantity}
          max={1_000_000}
          defaultValue={minimumQuantity}
          required
        />
      </label>
      <button disabled={busy}>{busy ? 'Adding…' : 'Add to cart'}</button>
      <Link href="/cart">View cart</Link>
      {message ? <p className="commerce-success">{message}</p> : null}
      {error ? <p className="commerce-error">{error}</p> : null}
    </form>
  );
}
