'use client';

import { customerInputSchema, type CustomerList } from '@ligimed/validation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

type Customer = CustomerList['customers'][number];

async function mutate(path: string, method: 'POST' | 'PATCH', csrfToken: string, body: object) {
  const response = await fetch(`/api/customers/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = (await response.json()) as { detail?: string };
    throw new Error(problem.detail ?? 'Customer request failed.');
  }
}

export function CustomerManager({
  customers,
  csrfToken,
  query,
}: {
  customers: CustomerList;
  csrfToken: string;
  query: { q: string; status: 'ACTIVE' | 'ARCHIVED' };
}) {
  const [editing, setEditing] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const phoneValue = values.get('phone');
    const phone = (typeof phoneValue === 'string' ? phoneValue : '').replace(/\D/g, '');
    const emailValue = values.get('email');
    const input = customerInputSchema.safeParse({
      displayName: values.get('displayName'),
      phoneNumber: phone ? `+91${phone}` : null,
      email: (typeof emailValue === 'string' ? emailValue : '').trim() || null,
    });
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the customer details.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await mutate(
        editing ? editing.id : 'create',
        editing ? 'PATCH' : 'POST',
        csrfToken,
        input.data,
      );
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the customer.');
      setBusy(false);
    }
  }

  async function changeState(customer: Customer) {
    if (
      query.status === 'ACTIVE' &&
      !window.confirm(`Archive ${customer.displayName}? You can restore this record later.`)
    )
      return;
    setBusy(true);
    setError('');
    try {
      await mutate(
        `${customer.id}/${query.status === 'ACTIVE' ? 'archive' : 'restore'}`,
        'POST',
        csrfToken,
        {},
      );
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this customer.');
      setBusy(false);
    }
  }

  const next = new URLSearchParams({ status: query.status });
  if (query.q) next.set('q', query.q);
  if (customers.page.nextCursor) next.set('cursor', customers.page.nextCursor);

  return (
    <>
      <div className="customers-toolbar">
        <form action="/customers" className="customers-search">
          <label htmlFor="customer-search">Search customers</label>
          <input
            id="customer-search"
            name="q"
            defaultValue={query.q}
            placeholder="Name, mobile or email"
            maxLength={100}
          />
          <select name="status" defaultValue={query.status} aria-label="Customer status">
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <button type="submit">Search</button>
        </form>
        <button
          className="customers-primary"
          type="button"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
            setError('');
          }}
        >
          Add customer
        </button>
      </div>
      {error ? (
        <p className="customers-error" role="alert">
          {error}
        </p>
      ) : null}
      {formOpen ? (
        <section
          className="customers-form-panel"
          aria-label={editing ? 'Edit customer' : 'Add customer'}
        >
          <div className="customers-panel-heading">
            <div>
              <span className="section-label">CUSTOMER DETAILS</span>
              <h2>{editing ? 'Edit customer' : 'Add a customer'}</h2>
            </div>
            <button
              type="button"
              className="customers-text-button"
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
                setError('');
              }}
            >
              Close
            </button>
          </div>
          <form
            key={editing?.id ?? 'new'}
            onSubmit={(event) => void save(event)}
            className="customers-entry-form"
          >
            <label>
              Full name
              <input
                name="displayName"
                required
                minLength={2}
                maxLength={200}
                defaultValue={editing?.displayName ?? ''}
                autoComplete="name"
              />
            </label>
            <label>
              Mobile number <span>(optional)</span>
              <div className="customers-phone">
                <span>+91</span>
                <input
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                  defaultValue={editing?.phoneNumber?.replace(/^\+91/, '') ?? ''}
                  autoComplete="tel-national"
                  placeholder="10-digit number"
                />
              </div>
            </label>
            <label>
              Email <span>(optional)</span>
              <input
                name="email"
                type="email"
                maxLength={320}
                defaultValue={editing?.email ?? ''}
                autoComplete="email"
                placeholder="name@example.com"
              />
            </label>
            <button className="customers-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Save customer'}
            </button>
          </form>
          <p className="customers-privacy">
            Contact details are unverified. Do not use them for messages without the customer’s
            permission.
          </p>
        </section>
      ) : null}
      <section className="customers-list" aria-label="Customer records">
        <div className="customers-list-header">
          <h2>{query.status === 'ACTIVE' ? 'Active customers' : 'Archived customers'}</h2>
          <span>{customers.customers.length} shown</span>
        </div>
        {customers.customers.length ? (
          <div className="customers-table-wrap">
            <table className="customers-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Added</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.displayName}</strong>
                    </td>
                    <td>
                      {customer.phoneNumber ? <span>{customer.phoneNumber}</span> : null}
                      {customer.email ? <small>{customer.email}</small> : null}
                      {!customer.phoneNumber && !customer.email ? (
                        <span className="customers-muted">No contact details</span>
                      ) : null}
                    </td>
                    <td>
                      {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(
                        new Date(customer.createdAt),
                      )}
                    </td>
                    <td>
                      <div className="customers-actions">
                        {query.status === 'ACTIVE' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditing(customer);
                              setFormOpen(true);
                              setError('');
                            }}
                          >
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void changeState(customer)}
                        >
                          {query.status === 'ACTIVE' ? 'Archive' : 'Restore'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="customers-empty">
            <h3>
              {query.q
                ? 'No matching customers'
                : query.status === 'ACTIVE'
                  ? 'No customers yet'
                  : 'No archived customers'}
            </h3>
            <p>
              {query.q
                ? 'Try a different search.'
                : query.status === 'ACTIVE'
                  ? 'Add your first customer to keep their details in one place.'
                  : 'Archived records will appear here.'}
            </p>
          </div>
        )}
        {customers.page.hasMore ? (
          <Link className="customers-more" href={`/customers?${next}`}>
            Show more customers →
          </Link>
        ) : null}
      </section>
    </>
  );
}
