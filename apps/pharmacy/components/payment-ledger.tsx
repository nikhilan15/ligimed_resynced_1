'use client';

import {
  invoiceDetailSchema,
  invoicePaymentEntryInputSchema,
  type InvoiceDetail,
} from '@ligimed/validation';
import { useRef, useState, type FormEvent } from 'react';

function money(value: string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}

function minorUnits(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

export function PaymentLedger({
  invoice,
  csrfToken,
}: {
  invoice: InvoiceDetail;
  csrfToken: string;
}) {
  const [ledger, setLedger] = useState(invoice.paymentLedger);
  const [kind, setKind] = useState<'PAYMENT' | 'REFUND'>('PAYMENT');
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'UPI' | 'CARD' | 'OTHER'>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{
    fingerprint: string;
    idempotencyKey: string;
    occurredAt: string;
  } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const amountMinor = minorUnits(amount);
    if (!amountMinor || BigInt(amountMinor) === 0n) {
      setError('Enter an amount greater than zero, with at most two decimal places.');
      return;
    }
    const fingerprint = JSON.stringify({ kind, method, amountMinor, reference: reference.trim() });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = {
        fingerprint,
        idempotencyKey: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
      };
    const parsed = invoicePaymentEntryInputSchema.safeParse({
      idempotencyKey: pending.current.idempotencyKey,
      type: kind,
      method,
      amountMinor,
      reference: reference.trim() || null,
      occurredAt: pending.current.occurredAt,
    });
    if (!parsed.success) {
      setError('Check the payment details and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/billing/${invoice.id}/payment-entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(parsed.data),
      });
      const body = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(body.detail ?? 'Could not record this entry.');
      const updated = invoiceDetailSchema.parse(body);
      setLedger(updated.paymentLedger);
      setAmount('');
      setReference('');
      pending.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record this entry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="billing-detail-card payment-ledger" aria-labelledby="payment-ledger-title">
      <div className="payment-ledger-heading">
        <div>
          <span className="section-label">PAYMENT RECORDS</span>
          <h2 id="payment-ledger-title">Offline payment ledger</h2>
        </div>
        <strong>{ledger.status.replaceAll('_', ' ').toLowerCase()}</strong>
      </div>
      <p className="payment-ledger-note">
        These are pharmacy-entered records only. They do not initiate or verify a transfer, gateway
        payment, or settlement.
      </p>
      <div className="payment-ledger-balance">
        <span>Net recorded: {money(ledger.recordedNet.amountMinor)}</span>
        <strong>Remaining: {money(ledger.remaining.amountMinor)}</strong>
      </div>
      {ledger.entries.length ? (
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(
                      new Date(entry.occurredAt),
                    )}
                  </td>
                  <td>{entry.type === 'PAYMENT' ? 'Payment recorded' : 'Refund recorded'}</td>
                  <td>{entry.method.replaceAll('_', ' ').toLowerCase()}</td>
                  <td>{entry.reference ?? '—'}</td>
                  <td>
                    {entry.type === 'REFUND' ? '−' : ''}
                    {money(entry.amount.amountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="payment-ledger-note">No payments or refunds have been recorded.</p>
      )}
      <form
        className="payment-ledger-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label>
          Entry
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="PAYMENT">Payment received / sent</option>
            <option value="REFUND">Refund sent / received</option>
          </select>
        </label>
        <label>
          Method
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as typeof method)}
          >
            <option value="CASH">Cash</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label>
          Amount (₹)
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </label>
        <label>
          Reference (optional)
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={120}
            placeholder="Bank / receipt reference"
          />
        </label>
        <button disabled={busy} type="submit">
          {busy ? 'Recording…' : 'Record entry'}
        </button>
      </form>
      {error ? (
        <p className="payment-ledger-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
