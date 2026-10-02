'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { documentReviewInputSchema, type DocumentDetail } from '@ligimed/validation';

export function DocumentReview({
  document,
  csrfToken,
}: {
  document: DocumentDetail;
  csrfToken: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function review(status: 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED') {
    if (busy) return;
    const parsed = documentReviewInputSchema.safeParse({
      expectedStatus: document.reviewStatus,
      status,
      reason: reason.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the review details.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/documents/uploads/${document.id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(parsed.data),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? 'The review could not be saved.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review failed.');
    } finally {
      setBusy(false);
    }
  }
  if (document.superseded || !['PENDING_REVIEW', 'UNDER_REVIEW'].includes(document.reviewStatus))
    return (
      <p className="doc-muted">
        This version is {document.superseded ? 'superseded' : document.reviewStatus.toLowerCase()}.
        Its decision and original file are retained.
      </p>
    );
  return (
    <section className="doc-detail-card">
      <h2>Compliance decision</h2>
      <p className="doc-muted">
        Check the original file and metadata. Verification here does not activate a pharmacy or
        validate a settlement.
      </p>
      {document.reviewStatus === 'UNDER_REVIEW' ? (
        <label className="admin-document-reason">
          Review note / rejection reason
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="Explain what needs correcting when requesting a re-upload."
          />
        </label>
      ) : null}
      <div className="document-review-actions">
        {document.reviewStatus === 'PENDING_REVIEW' ? (
          <button
            className="doc-primary"
            disabled={busy}
            onClick={() => {
              void review('UNDER_REVIEW');
            }}
          >
            Start review
          </button>
        ) : (
          <>
            <button
              className="doc-primary"
              disabled={busy}
              onClick={() => {
                void review('VERIFIED');
              }}
            >
              Verify document
            </button>
            <button
              className="doc-secondary"
              disabled={busy}
              onClick={() => {
                void review('REJECTED');
              }}
            >
              Reject & request re-upload
            </button>
          </>
        )}
      </div>
      {error ? (
        <p className="doc-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
