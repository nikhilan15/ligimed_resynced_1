'use client';

import { Button, GoogleSignInButton } from '@ligimed/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { authRequest } from '../lib/auth-client';

interface Bootstrap {
  csrfToken: string;
  googleClientId: string | null;
  googleNonce: string;
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [pharmacyName, setPharmacyName] = useState('');
  const [credential, setCredential] = useState('');
  const [choices, setChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const register = mode === 'register';

  useEffect(() => {
    let active = true;
    void authRequest('bootstrap')
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
    if (register && (pharmacyName.trim().length < 2 || pharmacyName.trim().length > 250)) {
      setError('Enter your pharmacy’s legal name before continuing.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = (await authRequest(
        'google/verify',
        {
          credential: token,
          intent: register ? 'REGISTER' : 'LOGIN',
          ...(register ? { organizationName: pharmacyName.trim() } : {}),
          ...(membershipId ? { membershipId } : {}),
        },
        bootstrap.csrfToken,
      )) as { status: string; memberships?: Array<{ id: string; name: string }> };
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
    <div className="auth-content">
      <div className="auth-topline">
        {register ? 'ALREADY WITH LIGIMED?' : 'NEW TO LIGIMED?'}{' '}
        <Link href={register ? '/login' : '/register'}>
          {register ? 'Sign in' : 'Create an account'} <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <div className="form-heading">
        <span className="section-label">PHARMACY ACCESS</span>
        <h2>
          {choices.length
            ? 'Choose your pharmacy'
            : register
              ? 'Let’s get you started.'
              : 'Welcome back.'}
        </h2>
        <p>
          {register
            ? 'Create your pharmacy account with Google. Verification is a separate step.'
            : 'Sign in securely with your Google account.'}
        </p>
      </div>
      {error ? (
        <div role="alert" className="form-alert">
          {error}
        </div>
      ) : null}
      {choices.length ? (
        <div className="pharmacy-choices">
          {choices.map((choice) => (
            <Button
              key={choice.id}
              variant="secondary"
              disabled={busy}
              onClick={() => void verify(credential, choice.id)}
            >
              {choice.name} <span aria-hidden="true">→</span>
            </Button>
          ))}
        </div>
      ) : (
        <div className="auth-form">
          {register ? (
            <div className="field-group">
              <label htmlFor="pharmacy">Pharmacy legal name</label>
              <input
                id="pharmacy"
                name="pharmacy"
                autoComplete="organization"
                minLength={2}
                maxLength={250}
                value={pharmacyName}
                onChange={(event) => setPharmacyName(event.target.value)}
                placeholder="Enter your pharmacy’s legal name"
              />
            </div>
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
          <p className="auth-reassurance">
            Use the Google account linked to your LigiMed membership.
          </p>
        </div>
      )}
    </div>
  );
}
