'use client';

import { Button } from '@ligimed/ui';
import { useState } from 'react';

import { adminRequest } from '../lib/admin-client';

export function ReviewActions({
  recordId,
  status,
  csrfToken,
}: {
  recordId: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW';
  csrfToken: string;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function action(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await adminRequest('reviews', `kyc/${recordId}/${path}`, body, csrfToken);
      window.location.replace(path === 'decision' ? '/reviews' : `/reviews/${recordId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The review action failed.');
      setBusy(false);
    }
  }

  return (
    <section className="review-actions">
      <span className="admin-label">REVIEW DECISION</span>
      {error ? (
        <div className="admin-alert error" role="alert">
          {error}
        </div>
      ) : null}
      {status === 'SUBMITTED' ? (
        <Button disabled={busy} onClick={() => void action('start-review', {})}>
          Start review
        </Button>
      ) : (
        <>
          <p>
            Approval verifies this KYC revision, activates the pharmacy, and revokes its onboarding
            sessions. The pharmacy must sign in again.
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Approve this KYC record and activate the pharmacy? This privileged action is audited.',
                )
              )
                void action('decision', { decision: 'APPROVE' });
            }}
          >
            Approve &amp; activate
          </Button>
          <label htmlFor="rejection-reason">Rejection reason</label>
          <textarea
            id="rejection-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={10}
            maxLength={1000}
            placeholder="Provide clear, actionable feedback"
          />
          <Button
            variant="secondary"
            disabled={busy || reason.trim().length < 10}
            onClick={() => {
              if (window.confirm('Reject this KYC revision with the supplied reason?'))
                void action('decision', { decision: 'REJECT', reason });
            }}
          >
            Reject submission
          </Button>
        </>
      )}
    </section>
  );
}
