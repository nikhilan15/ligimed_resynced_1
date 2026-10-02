'use client';

import { Button } from '@ligimed/ui';
import { useState } from 'react';

import { adminRequest } from '../lib/admin-client';

export function AdminLogoutButton({ csrfToken }: { csrfToken: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void adminRequest('auth', 'logout', {}, csrfToken).finally(() =>
          window.location.replace('/login'),
        );
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
