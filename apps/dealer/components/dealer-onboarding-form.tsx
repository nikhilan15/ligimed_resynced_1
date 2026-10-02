'use client';

import {
  dealerKycProfileInputSchema,
  dealerKycStateSchema,
  kycEvidenceMetadataSchema,
  type DealerKycState,
} from '@ligimed/validation';
import { useState, type FormEvent } from 'react';

async function readState(response: Response) {
  const data = (await response.json()) as { detail?: string };
  if (!response.ok) throw new Error(data.detail ?? 'The request failed.');
  return dealerKycStateSchema.parse(data);
}

function value(data: FormData, key: string) {
  const entry = data.get(key);
  return typeof entry === 'string' ? entry.trim() : '';
}

export function DealerOnboardingForm({
  initialState,
  csrfToken,
}: {
  initialState: DealerKycState;
  csrfToken: string;
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('BUSINESS_REGISTRATION');
  const [referenceNumber, setReferenceNumber] = useState('');
  const editable = state.kyc.editable;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = dealerKycProfileInputSchema.safeParse({
      legalName: value(data, 'legalName'),
      tradeName: value(data, 'tradeName'),
      operationalEmail: value(data, 'operationalEmail'),
      websiteUrl: value(data, 'websiteUrl'),
      authorizedRepresentativeName: value(data, 'representative'),
      authorizedRepresentativeRole: value(data, 'representativeRole'),
      summary: value(data, 'summary'),
      serviceAreas: value(data, 'serviceAreas')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      address: {
        name: value(data, 'addressName'),
        line1: value(data, 'line1'),
        line2: value(data, 'line2'),
        city: value(data, 'city'),
        district: value(data, 'district'),
        state: value(data, 'state'),
        stateCode: value(data, 'stateCode'),
        postalCode: value(data, 'postalCode'),
        country: 'IN',
      },
    });
    if (!parsed.success)
      return setError('Check the profile fields, address and six-digit PIN code.');
    await run(async () => {
      const response = await fetch('/api/onboarding/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify(parsed.data),
      });
      setState(await readState(response));
      setMessage('Profile draft saved.');
    });
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || file.size === 0 || file.size > 5_242_880)
      return setError('Choose a PDF, PNG or JPEG under 5 MB.');
    const metadata = kycEvidenceMetadataSchema.safeParse({
      category,
      referenceNumber,
      expiresAt: '',
    });
    if (!metadata.success) return setError('Choose a valid document category.');
    await run(async () => {
      const query = new URLSearchParams({ category, referenceNumber, expiresAt: '' });
      const response = await fetch(`/api/onboarding/evidence?${query}`, {
        method: 'POST',
        headers: {
          'content-type': file.type,
          'x-csrf-token': csrfToken,
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      setState(await readState(response));
      setFile(null);
      setReferenceNumber('');
      setMessage('Document uploaded securely.');
    });
  }

  async function remove(id: string) {
    await run(async () => {
      const response = await fetch(`/api/onboarding/evidence/${id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      setState(await readState(response));
      setMessage('Document removed.');
    });
  }

  async function submit() {
    await run(async () => {
      const response = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ declarationAccepted: true }),
      });
      setState(await readState(response));
      setMessage('KYC submitted for review.');
    });
  }

  return (
    <div className="onboarding-layout">
      <div className="page-heading">
        <span className="eyebrow">DEALER VERIFICATION</span>
        <h1>Complete your dealer profile</h1>
        <p>
          Your public profile stays hidden until an authorized reviewer approves your submission.
        </p>
      </div>
      <div className="status-card">
        <strong>KYC status: {state.kyc.status.replace('_', ' ')}</strong>
        <span>Revision {state.kyc.revision ?? 'not started'}</span>
        {state.kyc.rejectionReason && (
          <p className="alert error">Review feedback: {state.kyc.rejectionReason}</p>
        )}
        {!editable && (
          <p>
            Changes are locked while this submission is under review. If approved, sign in again for
            full access.
          </p>
        )}
      </div>
      {message && (
        <div role="status" className="alert success">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {editable && (
        <>
          <form onSubmit={(event) => void save(event)} className="panel form-grid">
            <h2>Business details</h2>
            <label>
              Legal name
              <input
                name="legalName"
                defaultValue={state.dealer.legalName}
                minLength={2}
                maxLength={250}
                required
              />
            </label>
            <label>
              Trade name
              <input name="tradeName" defaultValue={state.dealer.tradeName ?? ''} maxLength={250} />
            </label>
            <label>
              Operational email
              <input
                name="operationalEmail"
                type="email"
                defaultValue={state.dealer.operationalEmail ?? ''}
              />
            </label>
            <label>
              Website
              <input name="websiteUrl" type="url" defaultValue={state.dealer.websiteUrl ?? ''} />
            </label>
            <label>
              Representative name
              <input
                name="representative"
                defaultValue={state.kyc.authorizedRepresentativeName}
                minLength={2}
                maxLength={200}
                required
              />
            </label>
            <label>
              Representative role
              <input
                name="representativeRole"
                defaultValue={state.kyc.authorizedRepresentativeRole ?? ''}
                maxLength={100}
              />
            </label>
            <label className="wide">
              Public summary
              <textarea
                name="summary"
                defaultValue={state.dealer.summary ?? ''}
                maxLength={1000}
                rows={3}
              />
            </label>
            <label className="wide">
              Service areas (comma-separated)
              <input
                name="serviceAreas"
                defaultValue={state.dealer.serviceAreas.join(', ')}
                placeholder="Chennai, Bengaluru"
              />
            </label>
            <h2>Primary address</h2>
            <label className="wide">
              Address name
              <input
                name="addressName"
                defaultValue={state.dealer.address?.name ?? 'Primary dealer address'}
                required
              />
            </label>
            <label className="wide">
              Address line 1
              <input name="line1" defaultValue={state.dealer.address?.line1 ?? ''} required />
            </label>
            <label className="wide">
              Address line 2<input name="line2" defaultValue={state.dealer.address?.line2 ?? ''} />
            </label>
            <label>
              City
              <input name="city" defaultValue={state.dealer.address?.city ?? ''} required />
            </label>
            <label>
              District
              <input name="district" defaultValue={state.dealer.address?.district ?? ''} required />
            </label>
            <label>
              State
              <input name="state" defaultValue={state.dealer.address?.state ?? ''} required />
            </label>
            <label>
              State code
              <input
                name="stateCode"
                defaultValue={state.dealer.address?.stateCode ?? ''}
                required
              />
            </label>
            <label>
              PIN code
              <input
                name="postalCode"
                inputMode="numeric"
                pattern="[0-9]{6}"
                defaultValue={state.dealer.address?.postalCode ?? ''}
                required
              />
            </label>
            <div className="wide">
              <button disabled={busy}>{busy ? 'Saving…' : 'Save profile draft'}</button>
            </div>
          </form>
          <form onSubmit={(event) => void upload(event)} className="panel stack">
            <h2>Supporting evidence</h2>
            <p>
              Upload at least one document. Categories are evidence options, not a legal sufficiency
              determination.
            </p>
            <label>
              Document category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="BUSINESS_REGISTRATION">Business registration</option>
                <option value="DRUG_LICENCE">Drug licence</option>
                <option value="GST_REGISTRATION">GST registration</option>
                <option value="PAN">PAN</option>
                <option value="BANK_DOCUMENT">Bank document</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              Reference number (optional)
              <input
                value={referenceNumber}
                onChange={(event) => setReferenceNumber(event.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              PDF, PNG or JPEG (maximum 5 MB)
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button disabled={busy || !state.kyc.id || !file}>
              {busy ? 'Uploading…' : 'Upload document'}
            </button>
          </form>
        </>
      )}
      <section className="panel stack">
        <h2>Submitted documents</h2>
        {state.kyc.evidence.length ? (
          <ul className="evidence-list">
            {state.kyc.evidence.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.category.replace('_', ' ')}</strong>
                  <small>
                    {item.originalFilename} · {item.status}
                  </small>
                </div>
                <div>
                  <a href={`/api/onboarding/evidence/${item.id}/content`}>Download</a>
                  {editable && (
                    <button
                      type="button"
                      className="text-action"
                      disabled={busy}
                      onClick={() => void remove(item.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>No documents uploaded yet.</p>
        )}
      </section>
      {editable && (
        <section className="panel stack">
          <h2>Submit for review</h2>
          <p>{state.policyNotice}</p>
          <label className="checkbox">
            <input type="checkbox" id="declaration" /> I confirm I am authorized to submit this
            information and that it is accurate.
          </label>
          <button
            disabled={busy || !state.kyc.id || state.kyc.evidence.length === 0}
            onClick={() => {
              const checked = (document.getElementById('declaration') as HTMLInputElement)?.checked;
              if (!checked) setError('Accept the declaration before submitting.');
              else void submit();
            }}
          >
            Submit KYC for review
          </button>
        </section>
      )}
    </div>
  );
}
