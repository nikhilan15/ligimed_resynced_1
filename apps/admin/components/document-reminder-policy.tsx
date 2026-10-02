'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { documentPolicyInputSchema } from '@ligimed/validation';

export function DocumentReminderPolicy({
  thresholds,
  csrfToken,
}: {
  thresholds: number[];
  csrfToken: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(thresholds.join(', '));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function request(path: string, method: string, body: unknown) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch(`/api/documents/${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { detail?: string; created?: number };
      if (!response.ok) throw new Error(result.detail ?? 'Could not save reminder settings.');
      setMessage(
        path === 'policy'
          ? 'Reminder periods saved.'
          : `${result.created ?? 0} new reminders queued. Existing reminders were not duplicated.`,
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = documentPolicyInputSchema.safeParse({
      thresholds: value.split(',').map((entry) => Number(entry.trim())),
    });
    if (!parsed.success) {
      setError('Enter 1–8 unique reminder periods in days (1–3650), separated by commas.');
      return;
    }
    void request('policy', 'PUT', parsed.data);
  }
  return (
    <details className="doc-detail-card">
      <summary>Expiry reminder settings</summary>
      <p className="doc-muted">
        Default windows are 90, 60 and 30 days. An expired reminder is also generated. Events are
        deduplicated per document and threshold.
      </p>
      <form className="doc-filters" onSubmit={save}>
        <label>
          Days before expiry
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            maxLength={100}
          />
        </label>
        <button className="doc-primary" disabled={busy}>
          Save periods
        </button>
        <button
          className="doc-secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            void request('reminders/run', 'POST', {});
          }}
        >
          Run reminders now
        </button>
      </form>
      {message ? (
        <p role="status" className="doc-muted">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="doc-error">
          {error}
        </p>
      ) : null}
    </details>
  );
}
