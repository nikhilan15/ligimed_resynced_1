'use client';

import {
  billingOptionsSchema,
  purchaseInvoiceInputSchema,
  retailSaleInputSchema,
  type BillingOptions,
} from '@ligimed/validation';
import { useEffect, useState, type FormEvent } from 'react';

type Batch = BillingOptions['batches'][number];
type Customer = BillingOptions['customers'][number];
type Order = BillingOptions['orders'][number];
type SaleLine = { batch: Batch; quantity: string; unitPrice: string; tax: string };

function minor(value: string): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

function rupees(value: string) {
  const amount = BigInt(value);
  return `${new Intl.NumberFormat('en-IN').format(amount / 100n)}.${(amount % 100n).toString().padStart(2, '0')}`;
}

async function options(kind: 'customers' | 'batches' | 'orders', q = '') {
  const query = new URLSearchParams({ kind });
  if (q) query.set('q', q);
  const response = await fetch(`/api/billing/options?${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load billing choices.');
  return billingOptionsSchema.parse(await response.json());
}

async function record(path: string, csrfToken: string, body: object) {
  const response = await fetch(`/api/billing/${path}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { id?: string; detail?: string };
  if (!response.ok) throw new Error(result.detail ?? 'Billing request failed.');
  if (!result.id) throw new Error('Billing record was not returned.');
  window.location.assign(`/billing/${result.id}`);
}

export function BillingManager({
  csrfToken,
  purchaseOnly = false,
}: {
  csrfToken: string;
  purchaseOnly?: boolean;
}) {
  const [mode, setMode] = useState<'sale' | 'purchase'>(purchaseOnly ? 'purchase' : 'sale');
  const [saleKey] = useState(() => crypto.randomUUID());
  const [customerQuery, setCustomerQuery] = useState('');
  const [batchQuery, setBatchQuery] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [selectedBatch, setSelectedBatch] = useState('');
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([options('customers'), options('batches'), options('orders')])
      .then(([customerResult, batchResult, orderResult]) => {
        setCustomers(customerResult.customers);
        setBatches(batchResult.batches);
        setOrders(orderResult.orders);
      })
      .catch(() => setError('Could not load customers, stock, or orders. Refresh the page.'));
  }, []);

  async function search(kind: 'customers' | 'batches' | 'orders', q: string) {
    setError('');
    try {
      const result = await options(kind, q);
      if (kind === 'customers') setCustomers(result.customers);
      if (kind === 'batches') setBatches(result.batches);
      if (kind === 'orders') setOrders(result.orders);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search failed.');
    }
  }

  function addBatch() {
    const batch = batches.find((item) => item.id === selectedBatch);
    if (!batch || lines.some((line) => line.batch.id === batch.id)) return;
    setLines((current) => [...current, { batch, quantity: '1', unitPrice: '', tax: '0' }]);
    setSelectedBatch('');
  }

  function updateLine(index: number, patch: Partial<SaleLine>) {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  }

  async function saveSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!customer || !lines.length) {
      setError('Choose a customer and at least one stock batch.');
      return;
    }
    const parsed = retailSaleInputSchema.safeParse({
      idempotencyKey: saleKey,
      customerId: customer.id,
      lines: lines.map((line) => ({
        batchId: line.batch.id,
        quantity: Number(line.quantity),
        unitPriceMinor: minor(line.unitPrice),
        taxMinor: minor(line.tax),
      })),
    });
    if (!parsed.success) {
      setError('Enter valid quantities, prices and tax amounts in rupees (up to two decimals).');
      return;
    }
    if (!window.confirm('Record this sale and deduct its stock now? This action cannot be edited.'))
      return;
    setBusy(true);
    try {
      await record('retail-sales', csrfToken, parsed.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the sale.');
      setBusy(false);
    }
  }

  async function savePurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!order) {
      setError('Choose a dealer order.');
      return;
    }
    const values = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = values.get(name);
      return typeof value === 'string' ? value : '';
    };
    const parsed = purchaseInvoiceInputSchema.safeParse({
      orderId: order.id,
      referenceNumber: field('referenceNumber'),
      issuedAt: field('issuedAt'),
      subtotalMinor: minor(field('subtotal')),
      taxMinor: minor(field('tax')),
      deliveryChargeMinor: minor(field('delivery')),
    });
    if (!parsed.success) {
      setError('Enter a valid dealer invoice number, issue date and amounts.');
      return;
    }
    setBusy(true);
    try {
      await record('dealer-purchases', csrfToken, parsed.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the purchase invoice.');
      setBusy(false);
    }
  }

  return (
    <section className="billing-workflows" aria-label="Record billing activity">
      {!purchaseOnly ? (
        <div className="billing-mode-switch" role="tablist" aria-label="Billing workflow">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sale'}
            className={mode === 'sale' ? 'active' : ''}
            onClick={() => {
              setMode('sale');
              setError('');
            }}
          >
            Customer sale
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'purchase'}
            className={mode === 'purchase' ? 'active' : ''}
            onClick={() => {
              setMode('purchase');
              setError('');
            }}
          >
            Dealer purchase
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="customers-error" role="alert">
          {error}
        </p>
      ) : null}
      {mode === 'sale' ? (
        <form className="billing-form" onSubmit={(event) => void saveSale(event)}>
          <div className="billing-form-intro">
            <h2>Record a customer sale</h2>
            <p>Choose the exact batches sold. Stock is deducted when you confirm.</p>
          </div>
          <div className="billing-picker">
            <label htmlFor="billing-customer-search">Customer</label>
            <div className="billing-search-row">
              <input
                id="billing-customer-search"
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                placeholder="Search customer name"
              />
              <button type="button" onClick={() => void search('customers', customerQuery)}>
                Search
              </button>
            </div>
            <select
              aria-label="Select customer"
              value={customer?.id ?? ''}
              onChange={(event) =>
                setCustomer(customers.find((item) => item.id === event.target.value) ?? null)
              }
            >
              <option value="">Select a customer</option>
              {customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {customer && !customers.some((item) => item.id === customer.id) ? (
                <option value={customer.id}>{customer.name}</option>
              ) : null}
            </select>
          </div>
          <div className="billing-picker">
            <label htmlFor="billing-batch-search">Stock batch</label>
            <div className="billing-search-row">
              <input
                id="billing-batch-search"
                value={batchQuery}
                onChange={(event) => setBatchQuery(event.target.value)}
                placeholder="Search medicine name"
              />
              <button type="button" onClick={() => void search('batches', batchQuery)}>
                Search
              </button>
            </div>
            <div className="billing-search-row">
              <select
                aria-label="Select stock batch"
                value={selectedBatch}
                onChange={(event) => setSelectedBatch(event.target.value)}
              >
                <option value="">Select a batch</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name} · {batch.batchNumber} · {batch.quantityOnHand} available
                  </option>
                ))}
              </select>
              <button type="button" onClick={addBatch} disabled={!selectedBatch}>
                Add line
              </button>
            </div>
          </div>
          {lines.length ? (
            <div className="billing-lines">
              {lines.map((line, index) => (
                <div className="billing-line" key={line.batch.id}>
                  <div>
                    <strong>{line.batch.name}</strong>
                    <small>
                      Batch {line.batch.batchNumber} · {line.batch.quantityOnHand} on hand · expires{' '}
                      {line.batch.expiresAt}
                    </small>
                  </div>
                  <label>
                    Qty
                    <input
                      type="number"
                      min="1"
                      max={line.batch.quantityOnHand}
                      value={line.quantity}
                      onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    />
                  </label>
                  <label>
                    Unit price ₹
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                      placeholder="0.00"
                    />
                  </label>
                  <label>
                    Line tax ₹
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.tax}
                      onChange={(event) => updateLine(index, { tax: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="billing-remove"
                    onClick={() => setLines((current) => current.filter((_, at) => at !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <p className="billing-form-note">
            Tax amounts are entered by your pharmacy; LigiMed does not infer a tax rate. Confirm
            before recording.
          </p>
          <button className="customers-primary" disabled={busy || !lines.length}>
            {busy ? 'Recording…' : 'Record sale and deduct stock'}
          </button>
        </form>
      ) : (
        <form className="billing-form" onSubmit={(event) => void savePurchase(event)}>
          <div className="billing-form-intro">
            <h2>Record a dealer invoice</h2>
            <p>
              Enter details from the actual invoice supplied by the dealer. This does not create or
              pay one on their behalf.
            </p>
          </div>
          <div className="billing-picker">
            <label htmlFor="billing-order-search">Dealer order</label>
            <div className="billing-search-row">
              <input
                id="billing-order-search"
                value={orderQuery}
                onChange={(event) => setOrderQuery(event.target.value)}
                placeholder="Search order number or dealer"
              />
              <button type="button" onClick={() => void search('orders', orderQuery)}>
                Search
              </button>
            </div>
            <select
              aria-label="Select dealer order"
              value={order?.id ?? ''}
              onChange={(event) =>
                setOrder(orders.find((item) => item.id === event.target.value) ?? null)
              }
            >
              <option value="">Select an order</option>
              {orders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.orderNumber} · {item.dealerName} · {item.status}
                </option>
              ))}
              {order && !orders.some((item) => item.id === order.id) ? (
                <option value={order.id}>
                  {order.orderNumber} · {order.dealerName}
                </option>
              ) : null}
            </select>
            {order ? (
              <small>
                Order total: ₹{rupees(order.total.amountMinor)} · {order.status}
              </small>
            ) : null}
          </div>
          <div className="billing-purchase-fields">
            <label>
              Dealer invoice number
              <input
                name="referenceNumber"
                required
                maxLength={100}
                placeholder="As printed on dealer invoice"
              />
            </label>
            <label>
              Issue date
              <input
                name="issuedAt"
                required
                type="date"
                max={new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label>
              Subtotal ₹<input name="subtotal" required inputMode="decimal" placeholder="0.00" />
            </label>
            <label>
              Tax ₹<input name="tax" required inputMode="decimal" defaultValue="0" />
            </label>
            <label>
              Delivery ₹<input name="delivery" required inputMode="decimal" defaultValue="0" />
            </label>
          </div>
          <p className="billing-form-note">
            A mismatch or undelivered order stays unreconciled. No payment or settlement is created.
          </p>
          <button className="customers-primary" disabled={busy || !order}>
            {busy ? 'Recording…' : 'Record dealer invoice'}
          </button>
        </form>
      )}
    </section>
  );
}
