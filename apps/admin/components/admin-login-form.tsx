'use client';

import { GoogleSignInButton } from '@ligimed/ui';
import { useEffect, useState } from 'react';

import { adminRequest } from '../lib/admin-client';

interface Bootstrap {
  csrfToken: string;
  googleClientId: string | null;
  googleNonce: string;
}

export function AdminLoginForm() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void adminRequest('auth', 'bootstrap')
      .then((value) => {
        if (active) setBootstrap(value as Bootstrap);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Admin sign-in is unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function verify(credential: string) {
    if (!bootstrap) return;
    setBusy(true);
    setError('');
    try {
      await adminRequest('auth', 'google/verify', { credential }, bootstrap.csrfToken);
      window.location.replace('/reviews');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Admin sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-login-card">
      <span className="admin-label">PRIVILEGED ACCESS</span>
      <h1>LigiMed compliance</h1>
      <p>Only pre-provisioned internal reviewers can sign in.</p>
      {error ? (
        <div className="admin-alert error" role="alert">
          {error}
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
          Google Sign-In is not configured. Ask the LigiMed administrator to set GOOGLE_CLIENT_ID.
        </p>
      ) : null}
    </section>
  );
}
