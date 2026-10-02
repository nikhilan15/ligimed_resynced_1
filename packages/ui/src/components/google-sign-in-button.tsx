'use client';

import { useEffect, useRef, useState } from 'react';

interface GoogleAccountsId {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential?: string }) => void;
    auto_select: false;
  }): void;
  renderButton(
    element: HTMLElement,
    options: { theme: 'outline'; size: 'large'; width: number },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

let googleScript: Promise<void> | undefined;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  googleScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScript = undefined;
      reject(new Error('Google Sign-In could not load. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return googleScript;
}

export function GoogleSignInButton({
  clientId,
  nonce,
  disabled = false,
  onCredential,
  onError,
}: {
  clientId: string;
  nonce: string;
  disabled?: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const errorCallback = useRef(onError);
  const [loading, setLoading] = useState(true);
  callback.current = onCredential;
  errorCallback.current = onError;

  useEffect(() => {
    let active = true;
    void loadGoogleScript()
      .then(() => {
        if (!active || !container.current) return;
        const id = window.google?.accounts?.id;
        if (!id) throw new Error('Google Sign-In is unavailable.');
        id.initialize({
          client_id: clientId,
          nonce,
          auto_select: false,
          callback: (response) => {
            if (response.credential) callback.current(response.credential);
            else errorCallback.current('Google did not return a sign-in credential.');
          },
        });
        container.current.replaceChildren();
        id.renderButton(container.current, { theme: 'outline', size: 'large', width: 320 });
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (active)
          errorCallback.current(
            cause instanceof Error ? cause.message : 'Google Sign-In is unavailable.',
          );
      });
    return () => {
      active = false;
    };
  }, [clientId, nonce]);

  return (
    <div
      aria-busy={loading || disabled}
      style={{ opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
    >
      <div ref={container} />
      {loading ? <p>Loading Google Sign-In…</p> : null}
    </div>
  );
}
