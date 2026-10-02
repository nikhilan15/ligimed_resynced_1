'use client';

import {
  commerceOrderDetailSchema,
  type paymentMethods,
  pharmacyCartItemInputSchema,
  type PharmacyCart,
} from '@ligimed/validation';
import { useState, type FormEvent } from 'react';

function money(amountMinor: string) {
  const minor = BigInt(amountMinor);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

async function request(
  path: string,
  method: 'PUT' | 'DELETE' | 'POST',
  csrfToken: string,
  body?: unknown,
) {
  const response = await fetch(`/api/commerce/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = (await response.json()) as { detail?: string };
  if (!response.ok) throw new Error(result.detail ?? 'Commerce request failed.');
  return result;
}

export function CartManager({
  cart,
  csrfToken,
}: {
  cart: NonNullable<PharmacyCart['cart']>;
  csrfToken: string;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof paymentMethods)[number]>('CASH_ON_DELIVERY');

  async function update(event: FormEvent<HTMLFormElement>, listingId: string) {
    event.preventDefault();
    setBusy(listingId);
    setError('');
    const input = pharmacyCartItemInputSchema.safeParse({
      quantity: Number(new FormData(event.currentTarget).get('quantity')),
    });
    if (!input.success) {
      setError('Enter a valid quantity.');
      setBusy('');
      return;
    }
    try {
      await request(`cart/items/${listingId}`, 'PUT', csrfToken, input.data);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Update failed.');
      setBusy('');
    }
  }

  async function remove(listingId: string) {
    setBusy(listingId);
    setError('');
    try {
      await request(`cart/items/${listingId}`, 'DELETE', csrfToken);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Remove failed.');
      setBusy('');
    }
  }

  async function checkout() {
    setBusy('checkout');
    setError('');
    try {
      const order = commerceOrderDetailSchema.parse(
        await request('cart/checkout', 'POST', csrfToken, { paymentMethod }),
      );
      window.location.assign(`/orders/${order.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout failed.');
      setBusy('');
    }
  }

  return (
    <>
      {error ? <div className="commerce-error">{error}</div> : null}
      <div className="cart-list">
        {cart.items.map((item) => (
          <article className="cart-item" key={item.listingId}>
            <div>
              <strong>{item.name}</strong>
              <span>{[item.strength, item.packSize].filter(Boolean).join(' · ')}</span>
              <span>{money(item.unitPrice.amountMinor)} each</span>
            </div>
            <form onSubmit={(event) => void update(event, item.listingId)}>
              <label>
                Quantity
                <input name="quantity" type="number" min="1" defaultValue={item.quantity} />
              </label>
              <button disabled={busy === item.listingId}>Update</button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy === item.listingId}
                onClick={() => void remove(item.listingId)}
              >
                Remove
              </button>
            </form>
            <strong>{money(item.lineTotal.amountMinor)}</strong>
          </article>
        ))}
      </div>
      <section className="cart-summary">
        <span>{cart.itemCount} units</span>
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{money(cart.subtotal.amountMinor)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{money(cart.tax.amountMinor)}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>{money(cart.deliveryCharge.amountMinor)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              <strong>{money(cart.total.amountMinor)}</strong>
            </dd>
          </div>
        </dl>
        <label className="payment-method-select">
          Payment method
          <select
            value={paymentMethod}
            onChange={(event) =>
              setPaymentMethod(event.target.value as (typeof paymentMethods)[number])
            }
          >
            <option value="CASH_ON_DELIVERY">Cash on delivery</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="ONLINE" disabled>
              Online payment (provider not configured)
            </option>
          </select>
        </label>
        <button disabled={busy === 'checkout'} onClick={() => void checkout()}>
          {busy === 'checkout' ? 'Placing order…' : 'Place order'}
        </button>
        <small>
          {cart.pricingNotice} Prices and dealer eligibility are verified again during checkout.
        </small>
      </section>
    </>
  );
}
