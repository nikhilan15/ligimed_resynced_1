'use client';

import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';

import type { PharmacyKycState } from '@ligimed/validation';

const categories = [
  ['DRUG_LICENCE', 'Drug licence'],
  ['GST_REGISTRATION', 'GST registration'],
  ['PAN', 'PAN'],
  ['BUSINESS_REGISTRATION', 'Business registration'],
  ['BANK_DOCUMENT', 'Bank document'],
  ['OTHER', 'Other supporting document'],
] as const;

const categoryLabels = Object.fromEntries(categories) as Record<string, string>;

interface Problem {
  detail?: string;
  fieldErrors?: Array<{ path: string; message: string }>;
}

async function responseState(response: Response): Promise<PharmacyKycState> {
  if (response.ok) return (await response.json()) as PharmacyKycState;
  let problem: Problem;
  try {
    problem = (await response.json()) as Problem;
  } catch {
    throw new Error('The request could not be completed.');
  }
  throw new Error(problem.detail ?? 'The request could not be completed.');
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formString(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

export function OnboardingForm({
  initialState,
  csrfToken,
}: {
  initialState: PharmacyKycState;
  csrfToken: string;
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [declaration, setDeclaration] = useState(false);
  const editable = state.kyc.editable;
  const defaults = useMemo(
    () => ({
      legalName: state.pharmacy.legalName,
      tradeName: state.pharmacy.tradeName ?? '',
      operationalEmail: state.pharmacy.operationalEmail ?? '',
      websiteUrl: state.pharmacy.websiteUrl ?? '',
      authorizedRepresentativeName: state.kyc.authorizedRepresentativeName,
      authorizedRepresentativeRole: state.kyc.authorizedRepresentativeRole ?? '',
      name: state.pharmacy.address?.name ?? 'Primary pharmacy address',
      line1: state.pharmacy.address?.line1 ?? '',
      line2: state.pharmacy.address?.line2 ?? '',
      city: state.pharmacy.address?.city ?? '',
      district: state.pharmacy.address?.district ?? '',
      state: state.pharmacy.address?.state ?? '',
      stateCode: state.pharmacy.address?.stateCode ?? '',
      postalCode: state.pharmacy.address?.postalCode ?? '',
    }),
    [state],
  );

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('profile');
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/onboarding/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({
          legalName: data.get('legalName'),
          tradeName: data.get('tradeName'),
          operationalEmail: data.get('operationalEmail'),
          websiteUrl: data.get('websiteUrl'),
          authorizedRepresentativeName: data.get('authorizedRepresentativeName'),
          authorizedRepresentativeRole: data.get('authorizedRepresentativeRole'),
          address: {
            name: data.get('name'),
            line1: data.get('line1'),
            line2: data.get('line2'),
            city: data.get('city'),
            district: data.get('district'),
            state: data.get('state'),
            stateCode: data.get('stateCode'),
            postalCode: data.get('postalCode'),
            country: 'IN',
          },
        }),
      });
      setState(await responseState(response));
      setMessage({ kind: 'success', text: 'Profile draft saved securely.' });
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function uploadEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return setMessage({ kind: 'error', text: 'Choose a document first.' });
    if (file.size > 5_242_880)
      return setMessage({ kind: 'error', text: 'Documents must be 5 MB or smaller.' });
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams({
      category: formString(data, 'category'),
      referenceNumber: formString(data, 'referenceNumber'),
      expiresAt: formString(data, 'expiresAt'),
    });
    setBusy('evidence');
    setMessage(null);
    try {
      const response = await fetch(`/api/onboarding/evidence?${query}`, {
        method: 'POST',
        headers: {
          'content-type': file.type,
          'x-csrf-token': csrfToken,
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      setState(await responseState(response));
      setFile(null);
      event.currentTarget.reset();
      setMessage({ kind: 'success', text: 'Supporting document uploaded.' });
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function removeEvidence(id: string) {
    setBusy(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/onboarding/evidence/${id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      setState(await responseState(response));
      setMessage({ kind: 'success', text: 'Document removed.' });
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function submitKyc() {
    setBusy('submit');
    setMessage(null);
    try {
      const response = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ declarationAccepted: declaration }),
      });
      setState(await responseState(response));
      setMessage({ kind: 'success', text: 'KYC submitted for review.' });
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="onboarding-shell">
      <aside className="onboarding-summary">
        <span className="section-label">PHARMACY ONBOARDING</span>
        <h1>Complete your pharmacy profile.</h1>
        <p>Save your business details, attach evidence, then submit the record for review.</p>
        <ol className="onboarding-steps">
          <li className={state.kyc.id ? 'complete' : 'current'}>
            <span>1</span> Pharmacy profile
          </li>
          <li className={state.kyc.evidence.length ? 'complete' : state.kyc.id ? 'current' : ''}>
            <span>2</span> Supporting evidence
          </li>
          <li className={state.kyc.status !== 'DRAFT' ? 'complete' : ''}>
            <span>3</span> Submit for review
          </li>
        </ol>
        <div className={`kyc-status status-${state.kyc.status.toLowerCase()}`}>
          <small>CURRENT STATUS</small>
          <strong>{state.kyc.status.replaceAll('_', ' ')}</strong>
          {state.kyc.revision ? <span>Submission revision {state.kyc.revision}</span> : null}
        </div>
      </aside>

      <div className="onboarding-main">
        {message ? (
          <div className={`onboarding-alert ${message.kind}`} role="status">
            {message.text}
          </div>
        ) : null}
        {!editable ? (
          <div className="review-banner">
            <strong>Your submission is locked while it is being reviewed.</strong>
            <span>You can still view and securely download the submitted evidence.</span>
          </div>
        ) : null}
        {state.kyc.rejectionReason ? (
          <div className="onboarding-alert error">Review note: {state.kyc.rejectionReason}</div>
        ) : null}

        <form
          className="onboarding-card"
          onSubmit={(event) => void saveProfile(event)}
          key={`profile-${state.kyc.id}`}
        >
          <div className="card-heading">
            <div>
              <span className="step-number">01</span>
            </div>
            <div>
              <h2>Business profile</h2>
              <p>Use the names and primary address your reviewers should assess.</p>
            </div>
          </div>
          <fieldset disabled={!editable || busy !== null}>
            <div className="form-grid">
              <label className="wide">
                Legal business name
                <input
                  name="legalName"
                  defaultValue={defaults.legalName}
                  required
                  minLength={2}
                  maxLength={250}
                />
              </label>
              <label>
                Trade name
                <input name="tradeName" defaultValue={defaults.tradeName} maxLength={250} />
              </label>
              <label>
                Operational email
                <input
                  name="operationalEmail"
                  type="email"
                  defaultValue={defaults.operationalEmail}
                  maxLength={320}
                />
              </label>
              <label className="wide">
                Website
                <input
                  name="websiteUrl"
                  type="url"
                  placeholder="https://"
                  defaultValue={defaults.websiteUrl}
                  maxLength={2048}
                />
              </label>
              <label>
                Authorized representative
                <input
                  name="authorizedRepresentativeName"
                  defaultValue={defaults.authorizedRepresentativeName}
                  required
                  minLength={2}
                  maxLength={200}
                />
              </label>
              <label>
                Representative role
                <input
                  name="authorizedRepresentativeRole"
                  defaultValue={defaults.authorizedRepresentativeRole}
                  maxLength={100}
                />
              </label>
            </div>
            <h3 className="form-subheading">Primary pharmacy address</h3>
            <div className="form-grid">
              <label className="wide">
                Address label
                <input name="name" defaultValue={defaults.name} required maxLength={200} />
              </label>
              <label className="wide">
                Address line 1
                <input name="line1" defaultValue={defaults.line1} required maxLength={200} />
              </label>
              <label className="wide">
                Address line 2<input name="line2" defaultValue={defaults.line2} maxLength={200} />
              </label>
              <label>
                City
                <input name="city" defaultValue={defaults.city} required maxLength={100} />
              </label>
              <label>
                District
                <input name="district" defaultValue={defaults.district} required maxLength={100} />
              </label>
              <label>
                State
                <input name="state" defaultValue={defaults.state} required maxLength={100} />
              </label>
              <label>
                State code
                <input name="stateCode" defaultValue={defaults.stateCode} required maxLength={10} />
              </label>
              <label>
                PIN code
                <input
                  name="postalCode"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  defaultValue={defaults.postalCode}
                  required
                />
              </label>
              <label>
                Country
                <input value="India" disabled />
              </label>
            </div>
            <button className="primary-action" type="submit">
              {busy === 'profile' ? 'Saving…' : 'Save profile draft'} <span>→</span>
            </button>
          </fieldset>
        </form>

        <section className="onboarding-card">
          <div className="card-heading">
            <div>
              <span className="step-number">02</span>
            </div>
            <div>
              <h2>Supporting evidence</h2>
              <p>PDF, PNG or JPEG only, up to 5 MB. Files are private and never served publicly.</p>
            </div>
          </div>
          {state.kyc.evidence.length ? (
            <ul className="evidence-list">
              {state.kyc.evidence.map((item) => (
                <li key={item.id}>
                  <div className="document-icon">▤</div>
                  <div>
                    <strong>{item.originalFilename}</strong>
                    <span>
                      {categoryLabels[item.category]} · {formatBytes(item.contentLength)}
                    </span>
                    {item.referenceNumber ? <small>Reference: {item.referenceNumber}</small> : null}
                  </div>
                  <div className="evidence-actions">
                    <a href={`/api/onboarding/evidence/${item.id}/content`}>Download</a>
                    {editable ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void removeEvidence(item.id)}
                      >
                        {busy === item.id ? 'Removing…' : 'Remove'}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-evidence">
              Save the profile, then upload at least one supporting document.
            </p>
          )}
          {editable ? (
            <form className="evidence-form" onSubmit={(event) => void uploadEvidence(event)}>
              <fieldset disabled={!state.kyc.id || busy !== null}>
                <div className="form-grid">
                  <label>
                    Document category
                    <select name="category" defaultValue="DRUG_LICENCE">
                      {categories.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Reference number
                    <input name="referenceNumber" maxLength={100} />
                  </label>
                  <label>
                    Expiry date, if applicable
                    <input name="expiresAt" type="date" />
                  </label>
                  <label className="wide">
                    Choose document
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      required
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <button className="secondary-action" type="submit">
                  {busy === 'evidence' ? 'Uploading…' : 'Upload evidence'}
                </button>
              </fieldset>
            </form>
          ) : null}
        </section>

        <section className="onboarding-card submit-card">
          <div className="card-heading">
            <div>
              <span className="step-number">03</span>
            </div>
            <div>
              <h2>Submit for review</h2>
              <p>
                Submission locks this revision. A later rejection or expiry creates a new revision
                instead of overwriting its history.
              </p>
            </div>
          </div>
          <div className="compliance-notice">{state.policyNotice}</div>
          {editable ? (
            <>
              <label className="declaration">
                <input
                  type="checkbox"
                  checked={declaration}
                  onChange={(event) => setDeclaration(event.target.checked)}
                />{' '}
                <span>
                  I confirm that I am authorized to submit this information and that it is accurate
                  to the best of my knowledge.
                </span>
              </label>
              <button
                className="primary-action"
                type="button"
                disabled={!declaration || busy !== null || state.kyc.evidence.length === 0}
                onClick={() => void submitKyc()}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit KYC for review'} <span>→</span>
              </button>
            </>
          ) : state.kyc.submittedAt ? (
            <p className="submitted-date">
              Submitted {new Date(state.kyc.submittedAt).toLocaleString()}
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
