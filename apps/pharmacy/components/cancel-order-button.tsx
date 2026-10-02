'use client';

import { useState } from 'react';

export function CancelOrderButton({ orderId, csrfToken }: { orderId: string; csrfToken: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function cancel() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/commerce/orders/${orderId}/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: '{}',
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? 'Order cancellation failed.');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Order cancellation failed.');
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="secondary-button" disabled={busy} onClick={() => void cancel()}>
        {busy ? 'Cancelling…' : 'Cancel order'}
      </button>
      {error ? <p className="commerce-error">{error}</p> : null}
    </div>
  );
}
