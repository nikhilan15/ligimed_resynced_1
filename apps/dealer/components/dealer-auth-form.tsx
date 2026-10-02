'use client';

import { GoogleSignInButton } from '@ligimed/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Bootstrap {
  csrfToken: string;
  googleClientId: string | null;
  googleNonce: string;
}

async function request(path: string, body?: unknown, csrfToken?: string) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = (await response.json()) as {
    detail?: string;
    status?: string;
    memberships?: Array<{ id: string; name: string }>;
  };
  if (!response.ok) throw new Error(result.detail ?? 'Please try again.');
  return result;
}

export function DealerAuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [dealerName, setDealerName] = useState('');
  const [credential, setCredential] = useState('');
  const [choices, setChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const register = mode === 'register';

  useEffect(() => {
    let active = true;
    void request('bootstrap')
      .then((value) => {
        if (active) setBootstrap(value as Bootstrap);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Sign-in is unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function verify(token: string, membershipId?: string) {
    if (!bootstrap) return;
    if (register && (dealerName.trim().length < 2 || dealerName.trim().length > 250)) {
      setError('Enter your dealer legal name before continuing.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await request(
        'google/verify',
        {
          credential: token,
          intent: register ? 'REGISTER' : 'LOGIN',
          ...(register ? { organizationName: dealerName.trim() } : {}),
          ...(membershipId ? { membershipId } : {}),
        },
        bootstrap.csrfToken,
      );
      if (result.status === 'AUTHENTICATED') window.location.replace('/account');
      else if (result.memberships) {
        setCredential(token);
        setChoices(result.memberships);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google Sign-In failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-aside">
        <Link href="/" className="brand">
          ✚ LigiMed <small>DEALER</small>
        </Link>
        <div>
          <span className="eyebrow">TRUSTED SUPPLY NETWORK</span>
          <h1>Bring your medicines closer to the pharmacies that need them.</h1>
          <p>
            Set up your dealer profile, submit verification evidence, and join the LigiMed
            marketplace after approval.
          </p>
        </div>
        <p className="fine-print">
          Verification rules and acceptable documents require compliance review.
        </p>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <span className="eyebrow">DEALER ACCESS</span>
          <h2>
            {choices.length
              ? 'Choose your dealer'
              : register
                ? 'Create a dealer account'
                : 'Welcome back'}
          </h2>
          <p>
            {register
              ? 'Create your dealer account with Google.'
              : 'Sign in securely with your Google account.'}
          </p>
          {error ? (
            <div role="alert" className="alert error">
              {error}
            </div>
          ) : null}
          {choices.length ? (
            <div className="stack">
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  disabled={busy}
                  onClick={() => void verify(credential, choice.id)}
                >
                  {choice.name} →
                </button>
              ))}
            </div>
          ) : (
            <div className="stack">
              {register ? (
                <>
                  <label htmlFor="dealer-name">Dealer legal name</label>
                  <input
                    id="dealer-name"
                    value={dealerName}
                    onChange={(event) => setDealerName(event.target.value)}
                    minLength={2}
                    maxLength={250}
                    autoComplete="organization"
                  />
                </>
              ) : null}
              {bootstrap?.googleClientId ? (
                <GoogleSignInButton
                  clientId={bootstrap.googleClientId}
                  nonce={bootstrap.googleNonce}
                  disabled={busy}
                  onCredential={(token) => void verify(token)}
                  onError={setError}
                />
              ) : bootstrap ? (
                <p role="alert">
                  Google Sign-In is not configured. Ask the LigiMed administrator to set
                  GOOGLE_CLIENT_ID.
                </p>
              ) : null}
            </div>
          )}
          <p className="form-switch">
            {register ? 'Already registered?' : 'New dealer?'}{' '}
            <Link href={register ? '/login' : '/register'}>
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
