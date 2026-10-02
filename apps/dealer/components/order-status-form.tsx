'use client';

import { dealerOrderStatusInputSchema, type OrderStatusValue } from '@ligimed/validation';
import { useState, type FormEvent } from 'react';

const transitions: Record<OrderStatusValue, OrderStatusValue[]> = {
  PENDING: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['PACKED', 'CANCELLED'],
  PACKED: ['DISPATCHED'],
  DISPATCHED: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REJECTED: [],
  RETURN_REQUESTED: ['RETURNED'],
  RETURNED: [],
};

export function OrderStatusForm({
  orderId,
  status,
  csrfToken,
}: {
  orderId: string;
  status: OrderStatusValue;
  csrfToken: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = transitions[status];
  if (available.length === 0) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const parsed = dealerOrderStatusInputSchema.safeParse({
      status: form.get('status'),
      note: form.get('note'),
    });
    if (!parsed.success) {
      setError('Choose a valid next status and check the note.');
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`/api/commerce/orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(parsed.data),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? 'Status update failed.');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Status update failed.');
      setBusy(false);
    }
  }

  return (
    <form className="order-status-form" onSubmit={(event) => void submit(event)}>
      <label>
        Next status
        <select name="status" required>
          {available.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <label>
        Internal note (optional)
        <input name="note" maxLength={500} />
      </label>
      <button disabled={busy}>{busy ? 'Updating…' : 'Update order'}</button>
      {error ? <p className="alert error">{error}</p> : null}
    </form>
  );
}
