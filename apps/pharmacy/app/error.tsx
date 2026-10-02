'use client';

import { Button } from '@ligimed/ui';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="service-error">
      <h1>We couldn’t connect just now.</h1>
      <p>Your account is safe. Please try again in a moment.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
