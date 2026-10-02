'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  documentDefinitions,
  documentDetailSchema,
  documentUploadMetadataSchema,
  type DocumentDetail,
  type DocumentCategory,
} from '@ligimed/validation';

type Links = {
  orders: Array<{ id: string; orderNumber: string }>;
  invoices: Array<{ id: string; referenceNumber: string; orderId: string | null }>;
};
export function DocumentUpload({
  csrfToken,
  replacement,
}: {
  csrfToken: string;
  replacement?: DocumentDetail;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>(
    replacement?.category ?? 'DRUG_LICENCE',
  );
  const [links, setLinks] = useState<Links>({ orders: [], invoices: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  async function show() {
    setOpen(true);
    setError('');
    try {
      const response = await fetch('/api/documents/links', { cache: 'no-store' });
      if (!response.ok) throw new Error('Order and invoice links could not be loaded.');
      setLinks((await response.json()) as Links);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Links are unavailable.');
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 5_242_880 ||
      !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)
    ) {
      setError('Choose a PDF, JPG or PNG file up to 5 MB.');
      return;
    }
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value.trim() || null : null;
    };
    const input = {
      category,
      title: text('title'),
      referenceNumber: text('referenceNumber'),
      holderName: text('holderName'),
      licenceType: text('licenceType'),
      designation: text('designation'),
      issuedAt: text('issuedAt'),
      expiresAt: text('expiresAt'),
      bankAccountLast4: text('bankAccountLast4'),
      bankIfsc: text('bankIfsc')?.toUpperCase() ?? null,
      orderId: text('orderId'),
      invoiceId: text('invoiceId'),
      replacesDocumentId: replacement?.id ?? null,
    };
    const bytes = await file.arrayBuffer();
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (value) => value.toString(16).padStart(2, '0'),
    ).join('');
    const fingerprint = JSON.stringify({ ...input, digest, filename: file.name });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: crypto.randomUUID() };
    const parsed = documentUploadMetadataSchema.safeParse({
      ...input,
      idempotencyKey: pending.current.id,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the document details.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/documents/uploads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': file.type,
          'x-csrf-token': csrfToken,
          'x-file-name': encodeURIComponent(file.name),
          'x-document-metadata': encodeURIComponent(JSON.stringify(parsed.data)),
        },
        body: bytes,
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? 'The document could not be uploaded.');
      const document = documentDetailSchema.parse(result);
      pending.current = null;
      setOpen(false);
      router.push(`/documents/${document.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="doc-primary"
        type="button"
        onClick={() => {
          void show();
        }}
      >
        {replacement ? 'Upload replacement' : '+ Upload document'}
      </button>
      {open ? (
        <dialog
          ref={dialog}
          className="doc-modal"
          aria-labelledby="upload-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setOpen(false);
          }}
          onClose={() => setOpen(false)}
        >
          <div className="doc-heading">
            <div>
              <span className="doc-eyebrow">PRIVATE DOCUMENT</span>
              <h2 id="upload-title">{replacement ? 'Replace document' : 'Add to your library'}</h2>
            </div>
            <button
              type="button"
              disabled={busy}
              aria-label="Close upload form"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <p className="doc-muted">
            Original files and review history are preserved. New files go to the compliance review
            queue.
          </p>
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="doc-upload-form"
          >
            <label>
              Document type
              <select
                disabled={Boolean(replacement)}
                value={category}
                onChange={(event) => setCategory(event.target.value as DocumentCategory)}
              >
                {documentDefinitions.map(([key, label, group]) => (
                  <option key={key} value={key}>
                    {group.toLowerCase()} · {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                name="title"
                required
                minLength={2}
                maxLength={200}
                defaultValue={replacement?.title ?? ''}
                placeholder="e.g. Drug licence renewal 2026"
              />
            </label>
            <label className="doc-full">
              Original document
              <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required />
              <small>PDF, JPG or PNG · Maximum 5 MB</small>
            </label>
            <label>
              Document number
              <input
                name="referenceNumber"
                maxLength={100}
                placeholder={
                  category === 'GST_REGISTRATION' ? 'GSTIN' : 'Certificate / reference number'
                }
              />
            </label>
            <label>
              Business / account holder / person name
              <input
                name="holderName"
                maxLength={200}
                defaultValue={replacement?.holderName ?? ''}
              />
            </label>
            {category === 'DRUG_LICENCE' ? (
              <label className="doc-full">
                Licence type
                <input
                  name="licenceType"
                  maxLength={100}
                  placeholder="As stated on the licence"
                  defaultValue={replacement?.licenceType ?? ''}
                />
              </label>
            ) : null}
            {category === 'REPRESENTATIVE_KYC' ? (
              <label className="doc-full">
                Role / designation
                <input
                  name="designation"
                  maxLength={100}
                  defaultValue={replacement?.designation ?? ''}
                />
              </label>
            ) : null}
            <label>
              Issue date
              <input name="issuedAt" type="date" />
            </label>
            <label>
              Expiry date
              <input name="expiresAt" type="date" />
            </label>
            {category === 'BANK_DOCUMENT' ? (
              <>
                <label>
                  Account number — last 4 digits only
                  <input
                    name="bankAccountLast4"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                  />
                </label>
                <label>
                  IFSC
                  <input name="bankIfsc" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" maxLength={11} />
                </label>
                <p className="doc-muted doc-full">
                  Do not enter a complete account number. Bank documents are restricted and cannot
                  be shared from this page.
                </p>
              </>
            ) : null}
            <label>
              Link an order (optional)
              <select name="orderId">
                <option value="">No order</option>
                {links.orders.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.orderNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Link an invoice (optional)
              <select name="invoiceId">
                <option value="">No invoice</option>
                {links.invoices.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.referenceNumber}
                  </option>
                ))}
              </select>
            </label>
            {error ? (
              <p role="alert" className="doc-error doc-full">
                {error}
              </p>
            ) : null}
            <div className="doc-full doc-form-footer">
              <span className="doc-muted">Review the details before submitting.</span>
              <button className="doc-primary" disabled={busy} type="submit">
                {busy ? 'Uploading…' : 'Submit for review'}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
