'use client';

import Link from 'next/link';
import {
  billingOptionsSchema,
  customerInputSchema,
  customerPurchaseHistorySchema,
  invoiceDetailSchema,
  retailDraftListSchema,
  retailDraftSchema,
  retailDraftInputSchema,
  retailSaleInputSchema,
  type BillingOptions,
  type InvoiceList,
} from '@ligimed/validation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

type Batch = BillingOptions['batches'][number];
type Customer = BillingOptions['customers'][number];
type Line = { batch: Batch; quantity: number; unitPrice: string; discount: string; tax: string };

function toMinor(value: string): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
function fromMinor(value: string) {
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}
function money(value: bigint | string) {
  const minor = BigInt(value);
  return `₹${new Intl.NumberFormat('en-IN').format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}
async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init });
  const payload: unknown = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === 'object' &&
      'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : 'Request failed.';
    throw new Error(detail);
  }
  return payload;
}

export function RetailPos({
  csrfToken,
  recent,
}: {
  csrfToken: string;
  recent: InvoiceList['invoices'];
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Batch[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerHistory, setCustomerHistory] = useState<ReturnType<
    typeof customerPurchaseHistorySchema.parse
  > | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [drafts, setDrafts] = useState<ReturnType<typeof retailDraftListSchema.parse>['drafts']>(
    [],
  );
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saleKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ kind: 'batches', q: query });
      void fetchJson(`/api/billing/options?${params}`)
        .then((value) => {
          setResults(billingOptionsSchema.parse(value).batches);
          setHighlighted(0);
        })
        .catch(() => setError('Medicine search is unavailable. Check the connection and retry.'))
        .finally(() => setSearching(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ kind: 'customers', q: customerQuery });
      void fetchJson(`/api/billing/options?${params}`)
        .then((value) => setCustomers(billingOptionsSchema.parse(value).customers))
        .catch(() => setError('Customer search is unavailable.'));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [customerQuery]);

  useEffect(() => {
    if (!customer) {
      setCustomerHistory(null);
      return;
    }
    void fetchJson(`/api/billing/customers/${customer.id}/history`)
      .then((value) => setCustomerHistory(customerPurchaseHistorySchema.parse(value)))
      .catch(() => setCustomerHistory(null));
  }, [customer]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const totals = useMemo(
    () =>
      lines.reduce(
        (current, line) => {
          const price = toMinor(line.unitPrice);
          const discount = toMinor(line.discount);
          const tax = toMinor(line.tax);
          if (price === null || discount === null || tax === null)
            return { ...current, valid: false };
          return {
            subtotal: current.subtotal + BigInt(price) * BigInt(line.quantity),
            discount: current.discount + BigInt(discount),
            tax: current.tax + BigInt(tax),
            valid:
              current.valid &&
              Number.isInteger(line.quantity) &&
              line.quantity > 0 &&
              line.quantity <= line.batch.quantityOnHand &&
              BigInt(discount) <= BigInt(price) * BigInt(line.quantity) &&
              BigInt(tax) <= BigInt(price) * BigInt(line.quantity),
          };
        },
        { subtotal: 0n, discount: 0n, tax: 0n, valid: true },
      ),
    [lines],
  );

  function addBatch(batch: Batch) {
    setError('');
    setLines((current) =>
      current.some((line) => line.batch.id === batch.id)
        ? current
        : [...current, { batch, quantity: 1, unitPrice: '', discount: '0', tax: '0' }],
    );
    setQuery('');
    searchRef.current?.focus();
  }
  function updateLine(id: string, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.batch.id === id ? { ...line, ...patch } : line)),
    );
  }
  function request(path: string, method: string, body?: unknown) {
    return fetchJson(`/api/billing/${path}`, {
      method,
      headers: {
        'x-csrf-token': csrfToken,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  function draftPayload() {
    return retailDraftInputSchema.safeParse({
      customerId: customer?.id ?? null,
      lines: lines.map((line) => ({
        batchId: line.batch.id,
        quantity: line.quantity,
        unitPriceMinor: toMinor(line.unitPrice),
        discountMinor: toMinor(line.discount),
        taxMinor: toMinor(line.tax),
      })),
    });
  }
  async function refreshDrafts() {
    setDrafts(retailDraftListSchema.parse(await fetchJson('/api/billing/drafts')).drafts);
  }
  async function saveDraft() {
    const parsed = draftPayload();
    if (!parsed.success || !totals.valid) {
      setError('Enter a valid price, quantity, discount and tax for every line before saving.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = retailDraftSchema.parse(
        await request(
          draftId ? `drafts/${draftId}` : 'drafts',
          draftId ? 'PUT' : 'POST',
          parsed.data,
        ),
      );
      setDraftId(result.id);
      setNotice('Draft saved. Stock has not been deducted.');
      await refreshDrafts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save draft.');
    } finally {
      setBusy(false);
    }
  }
  async function loadDraft(id: string) {
    setBusy(true);
    setError('');
    try {
      const draft = retailDraftSchema.parse(await fetchJson(`/api/billing/drafts/${id}`));
      const missing = draft.lines.filter((line) => !line.batch);
      setLines(
        draft.lines
          .filter((line) => line.batch)
          .map((line) => ({
            batch: line.batch!,
            quantity: line.quantity,
            unitPrice: fromMinor(line.unitPriceMinor),
            discount: fromMinor(line.discountMinor),
            tax: fromMinor(line.taxMinor),
          })),
      );
      setDraftId(id);
      setCustomer(null);
      if (draft.customerId) {
        const result = billingOptionsSchema.parse(
          await fetchJson(
            `/api/billing/options?kind=customers&q=${encodeURIComponent(draft.customerName ?? '')}`,
          ),
        );
        setCustomer(result.customers.find((item) => item.id === draft.customerId) ?? null);
      }
      setShowDrafts(false);
      setNotice('Draft loaded. Review stock and prices before recording.');
      if (missing.length)
        setError(
          `${missing.length} unavailable batch line(s) were omitted. Review this bill before saving.`,
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load draft.');
    } finally {
      setBusy(false);
    }
  }
  async function removeDraft(id: string) {
    if (!window.confirm('Delete this saved draft?')) return;
    setBusy(true);
    try {
      await request(`drafts/${id}`, 'DELETE');
      await refreshDrafts();
      if (draftId === id) setDraftId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete draft.');
    } finally {
      setBusy(false);
    }
  }
  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = fields.get(name);
      return typeof value === 'string' ? value : '';
    };
    const phoneNumber = field('phoneNumber');
    const email = field('email');
    const parsed = customerInputSchema.safeParse({
      displayName: field('displayName'),
      phoneNumber: phoneNumber ? `+91${phoneNumber}` : null,
      email: email || null,
    });
    if (!parsed.success) {
      setError('Enter a name and a valid 10-digit Indian mobile number, if provided.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = (await fetchJson('/api/customers/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(parsed.data),
      })) as { id: string; displayName: string; phoneNumber: string | null; email: string | null };
      const next = {
        id: created.id,
        name: created.displayName,
        phoneNumber: created.phoneNumber,
        email: created.email,
      };
      setCustomer(next);
      setCustomers((current) => [next, ...current]);
      setShowCustomerForm(false);
      setNotice('Customer added to your pharmacy.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add customer.');
    } finally {
      setBusy(false);
    }
  }
  async function recordSale() {
    if (!customer) {
      setError('Select or add a customer first.');
      return;
    }
    if (!lines.length) {
      setError('Add at least one medicine.');
      return;
    }
    const draft = draftPayload();
    const parsed = retailSaleInputSchema.safeParse({
      idempotencyKey: saleKey,
      ...(draftId ? { draftId } : {}),
      customerId: customer.id,
      lines: draft.success ? draft.data.lines : [],
    });
    if (!parsed.success || !totals.valid) {
      setError('Check the quantity, price, discount and tax on each line.');
      return;
    }
    if (
      !window.confirm(
        `Record this ${money(totals.subtotal - totals.discount + totals.tax)} sale and deduct stock? This is an internal record, not a paid or statutory invoice.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const invoice = invoiceDetailSchema.parse(await request('retail-sales', 'POST', parsed.data));
      window.location.assign(`/billing/${invoice.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record sale.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-root">
      <div className="pos-heading">
        <div>
          <span className="section-label">RETAIL WORKSPACE</span>
          <h1>New bill</h1>
          <p>Find stock, build the sale, and record it in one place.</p>
        </div>
        <div className="pos-heading-actions">
          <button
            type="button"
            onClick={() => {
              setShowDrafts(!showDrafts);
              setShowRecent(false);
              void refreshDrafts().catch(() => setError('Could not load saved drafts.'));
            }}
          >
            Saved drafts
          </button>
          <button
            type="button"
            onClick={() => {
              setShowRecent(!showRecent);
              setShowDrafts(false);
            }}
          >
            Recent bills
          </button>
          <Link href="/billing/purchases">Dealer purchases ↗</Link>
        </div>
      </div>
      {error ? (
        <div className="pos-alert" role="alert">
          {error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
            ×
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="pos-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss notice">
            ×
          </button>
        </div>
      ) : null}
      {showDrafts ? (
        <section className="pos-drawer" aria-label="Saved bill drafts">
          <div className="pos-drawer-title">
            <h2>Saved drafts</h2>
            <button type="button" onClick={() => setShowDrafts(false)}>
              Close
            </button>
          </div>
          {drafts.length ? (
            drafts.map((draft) => (
              <div className="pos-drawer-row" key={draft.id}>
                <div>
                  <strong>{draft.customerName ?? 'Customer not selected'}</strong>
                  <small>
                    {draft.itemCount} items · Updated{' '}
                    {new Date(draft.updatedAt).toLocaleString('en-IN')}
                  </small>
                </div>
                <strong>{money(draft.total.amountMinor)}</strong>
                <button type="button" disabled={busy} onClick={() => void loadDraft(draft.id)}>
                  Open
                </button>
                <button type="button" disabled={busy} onClick={() => void removeDraft(draft.id)}>
                  Delete
                </button>
              </div>
            ))
          ) : (
            <p>No saved drafts yet.</p>
          )}
        </section>
      ) : null}
      {showRecent ? (
        <section className="pos-drawer" aria-label="Recent retail bills">
          <div className="pos-drawer-title">
            <h2>Recent bills</h2>
            <button type="button" onClick={() => setShowRecent(false)}>
              Close
            </button>
          </div>
          {recent.length ? (
            recent.map((invoice) => (
              <Link className="pos-drawer-row" href={`/billing/${invoice.id}`} key={invoice.id}>
                <div>
                  <strong>{invoice.counterpartyName}</strong>
                  <small>
                    {invoice.referenceNumber} ·{' '}
                    {new Date(invoice.recordedAt).toLocaleString('en-IN')}
                  </small>
                </div>
                <strong>{money(invoice.total.amountMinor)}</strong>
                <span>View ↗</span>
              </Link>
            ))
          ) : (
            <p>No retail bills recorded yet.</p>
          )}
          <Link href="/billing/history">View all billing records →</Link>
        </section>
      ) : null}
      <div className="pos-grid">
        <section className="pos-panel pos-search" aria-label="Medicine search">
          <div className="pos-panel-title">
            <span>01 / STOCK</span>
            <h2>Find medicines</h2>
          </div>
          <label htmlFor="pos-medicine-search">Search name, generic, manufacturer or batch</label>
          <div className="pos-search-field">
            <span aria-hidden="true">⌕</span>
            <input
              id="pos-medicine-search"
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHighlighted((at) => Math.min(at + 1, results.length - 1));
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlighted((at) => Math.max(at - 1, 0));
                }
                if (event.key === 'Enter' && results[highlighted]) {
                  event.preventDefault();
                  addBatch(results[highlighted]);
                }
                if (event.key === 'Escape') setQuery('');
              }}
              placeholder="Search your stock…"
              autoComplete="off"
            />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="pos-results-meta">
            <span>{searching ? 'Searching…' : `${results.length} available batches`}</span>
            <span>Earliest expiry first</span>
          </div>
          <div className="pos-results">
            {results.map((batch, index) => {
              const low = batch.quantityOnHand <= batch.reorderLevel;
              const near =
                new Date(`${batch.expiresAt}T00:00:00Z`).getTime() - Date.now() < 90 * 86400_000;
              return (
                <button
                  type="button"
                  className={`pos-result ${highlighted === index ? 'is-highlighted' : ''}`}
                  key={batch.id}
                  onClick={() => addBatch(batch)}
                  onMouseEnter={() => setHighlighted(index)}
                >
                  <span className="pos-result-icon" aria-hidden="true">
                    ✚
                  </span>
                  <span className="pos-result-copy">
                    <strong>{batch.name}</strong>
                    <small>
                      {[batch.genericName, batch.packSize, batch.manufacturerName]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                    <small>
                      Batch {batch.batchNumber} · Exp {batch.expiresAt}
                    </small>
                    <span className="pos-tags">
                      {low ? <em className="low">Low stock</em> : null}
                      {near ? <em className="near">Near expiry</em> : null}
                    </span>
                  </span>
                  <span className="pos-result-stock">
                    <strong>{batch.quantityOnHand}</strong>
                    <small>on hand</small>
                    <span>＋</span>
                  </span>
                </button>
              );
            })}
            {!searching && !results.length ? (
              <div className="pos-empty">
                No saleable stock found. Add a batch in <Link href="/inventory">Inventory</Link> or
                try another search.
              </div>
            ) : null}
          </div>
          <p className="pos-search-foot">
            Prices and tax are entered per line. Purchase cost is never used as a selling price.
          </p>
        </section>
        <section className="pos-panel pos-bill" aria-label="Current bill">
          <div className="pos-panel-title pos-bill-title">
            <div>
              <span>02 / CURRENT BILL</span>
              <h2>{draftId ? 'Saved draft' : 'New sale'}</h2>
              <small className="pos-bill-meta">
                {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date())} ·
                Reference assigned when recorded
              </small>
            </div>
            <span className="pos-count">
              {lines.reduce((sum, line) => sum + line.quantity, 0)} items
            </span>
          </div>
          <div className="pos-bill-columns">
            <span>MEDICINE / BATCH</span>
            <span>QTY</span>
            <span>PRICE · DISCOUNT · TAX</span>
            <span>LINE TOTAL</span>
          </div>
          <div className="pos-line-list">
            {lines.length ? (
              lines.map((line) => {
                const price = toMinor(line.unitPrice),
                  discount = toMinor(line.discount),
                  tax = toMinor(line.tax);
                const total =
                  price !== null && discount !== null && tax !== null
                    ? BigInt(price) * BigInt(line.quantity) - BigInt(discount) + BigInt(tax)
                    : null;
                return (
                  <div className="pos-line" key={line.batch.id}>
                    <div className="pos-line-name">
                      <strong>{line.batch.name}</strong>
                      <small>
                        Batch {line.batch.batchNumber} · Exp {line.batch.expiresAt}
                      </small>
                      {line.quantity > line.batch.quantityOnHand ? (
                        <small role="alert">Only {line.batch.quantityOnHand} available</small>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          setLines((current) =>
                            current.filter((item) => item.batch.id !== line.batch.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <div className="pos-qty">
                      <button
                        type="button"
                        aria-label={`Decrease ${line.batch.name} quantity`}
                        onClick={() =>
                          updateLine(line.batch.id, { quantity: Math.max(1, line.quantity - 1) })
                        }
                      >
                        −
                      </button>
                      <input
                        aria-label={`${line.batch.name} quantity`}
                        type="number"
                        min="1"
                        max={line.batch.quantityOnHand}
                        value={line.quantity}
                        onChange={(event) =>
                          updateLine(line.batch.id, { quantity: Number(event.target.value) })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Increase ${line.batch.name} quantity`}
                        onClick={() =>
                          updateLine(line.batch.id, {
                            quantity: Math.min(line.batch.quantityOnHand, line.quantity + 1),
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                    <div className="pos-line-values">
                      <label>
                        Unit ₹
                        <input
                          aria-label={`${line.batch.name} unit price in rupees`}
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(event) =>
                            updateLine(line.batch.id, { unitPrice: event.target.value })
                          }
                          placeholder="0.00"
                        />
                      </label>
                      <label>
                        Off ₹
                        <input
                          aria-label={`${line.batch.name} discount in rupees`}
                          inputMode="decimal"
                          value={line.discount}
                          onChange={(event) =>
                            updateLine(line.batch.id, { discount: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Tax ₹
                        <input
                          aria-label={`${line.batch.name} tax in rupees`}
                          inputMode="decimal"
                          value={line.tax}
                          onChange={(event) =>
                            updateLine(line.batch.id, { tax: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <strong className="pos-line-total">
                      {total !== null && total >= 0n ? money(total) : '—'}
                    </strong>
                  </div>
                );
              })
            ) : (
              <div className="pos-bill-empty">
                <span aria-hidden="true">＋</span>
                <h3>Your bill is empty</h3>
                <p>Search the stock on the left and select a batch to add it here.</p>
              </div>
            )}
          </div>
          <div className="pos-bill-bottom">
            <span>Exact batch quantities are checked again at confirmation.</span>
            <button type="button" disabled={busy || !lines.length} onClick={() => void saveDraft()}>
              {draftId ? 'Update draft' : 'Save draft'}
            </button>
          </div>
        </section>
        <aside className="pos-panel pos-checkout" aria-label="Customer and sale summary">
          <div className="pos-panel-title">
            <span>03 / CHECKOUT</span>
            <h2>Customer & summary</h2>
          </div>
          <div className="pos-customer">
            <div className="pos-section-heading">
              <h3>Customer</h3>
              <button type="button" onClick={() => setShowCustomerForm(!showCustomerForm)}>
                {showCustomerForm ? 'Cancel' : '+ Add new'}
              </button>
            </div>
            {showCustomerForm ? (
              <form className="pos-customer-form" onSubmit={(event) => void createCustomer(event)}>
                <label>
                  Name
                  <input name="displayName" required maxLength={200} placeholder="Customer name" />
                </label>
                <label>
                  Mobile (optional)
                  <span className="pos-phone">
                    <span>+91</span>
                    <input
                      name="phoneNumber"
                      inputMode="numeric"
                      pattern="[6-9][0-9]{9}"
                      placeholder="10-digit number"
                    />
                  </span>
                </label>
                <label>
                  Email (optional)
                  <input name="email" type="email" placeholder="name@example.com" />
                </label>
                <button type="submit" disabled={busy}>
                  Save customer
                </button>
              </form>
            ) : (
              <>
                <input
                  aria-label="Search customers"
                  value={customerQuery}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                  placeholder="Search name or mobile"
                />
                <select
                  aria-label="Select customer"
                  value={customer?.id ?? ''}
                  onChange={(event) =>
                    setCustomer(customers.find((item) => item.id === event.target.value) ?? null)
                  }
                >
                  <option value="">Select customer</option>
                  {customers.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                      {item.phoneNumber ? ` · ${item.phoneNumber}` : ''}
                    </option>
                  ))}
                  {customer && !customers.some((item) => item.id === customer.id) ? (
                    <option value={customer.id}>{customer.name}</option>
                  ) : null}
                </select>
              </>
            )}
            {customer ? (
              <div className="pos-customer-card">
                <strong>{customer.name}</strong>
                <small>{customer.phoneNumber ?? customer.email ?? 'No contact details'}</small>
                <span>
                  {customerHistory
                    ? `${customerHistory.purchaseCount} previous sale${customerHistory.purchaseCount === 1 ? '' : 's'}`
                    : 'History unavailable'}
                </span>
                {customerHistory?.recent.length ? (
                  <div className="pos-customer-history">
                    Last: {customerHistory.recent[0]?.productNames.slice(0, 2).join(', ')}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="pos-summary">
            <h3>Bill summary</h3>
            <div>
              <span>Subtotal</span>
              <strong>{money(totals.subtotal)}</strong>
            </div>
            <div>
              <span>Discount</span>
              <strong>− {money(totals.discount)}</strong>
            </div>
            <div>
              <span>Tax (entered per line)</span>
              <strong>{money(totals.tax)}</strong>
            </div>
            <div className="pos-grand">
              <span>Total</span>
              <strong>{money(totals.subtotal - totals.discount + totals.tax)}</strong>
            </div>
          </div>
          <div className="pos-payment">
            <h3>Payment status</h3>
            <p>
              Payment collection is not integrated. This action records a sale and deducts stock; it
              does not mark the bill paid.
            </p>
            <div className="pos-disabled-methods">
              <span>Cash</span>
              <span>UPI</span>
              <span>Card</span>
              <span>Credit</span>
            </div>
          </div>
          <div className="pos-submit">
            <button
              type="button"
              disabled={busy || !customer || !lines.length || !totals.valid}
              onClick={() => void recordSale()}
            >
              {busy ? 'Working…' : 'Record sale & deduct stock'} <span>→</span>
            </button>
            <p>
              Internal record only. Statutory invoice, PDF and digital sharing are not configured.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
