'use client';

import { Button } from '@ligimed/ui';
import { useState } from 'react';
import { authRequest, AuthRequestError } from '../lib/auth-client';

export function LogoutButton({ csrfToken }: { csrfToken: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await authRequest('logout', {}, csrfToken);
      window.location.replace('/login');
    } catch (cause) {
      if (cause instanceof AuthRequestError && cause.status === 401) {
        window.location.replace('/login');
        return;
      }
      setError('Could not sign out. Please try again.');
      setBusy(false);
    }
  }
  return (
    <div>
      <Button variant="secondary" disabled={busy} onClick={() => void logout()}>
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      {error && (
        <p role="alert" className="field-help">
          {error}
        </p>
      )}
    </div>
  );
}
