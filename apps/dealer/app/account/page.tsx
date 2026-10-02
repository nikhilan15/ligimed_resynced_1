import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DealerHeader } from '../../components/dealer-header';
import { readDealerKycState, readDealerSession } from '../../lib/api-server';

export default async function DealerAccount() {
  const [session, state] = await Promise.all([readDealerSession(), readDealerKycState()]);
  if (!session || !state) redirect('/login');
  return (
    <>
      <DealerHeader name={session.dealer.name} csrfToken={session.csrfToken} />
      <main className="account-page">
        <span className="eyebrow">YOUR DEALER ACCOUNT</span>
        <h1>Welcome, {session.user.displayName ?? 'partner'}.</h1>
        <p>Signed in to {session.dealer.name}.</p>
        <div className="account-card">
          <div className="account-status">
            <span className="badge">{session.dealer.status}</span>
            <span>Verification: {state.kyc.status.replace('_', ' ')}</span>
          </div>
          <h2>{session.dealer.name}</h2>
          {session.access === 'ONBOARDING' ? (
            <p>
              Your dealer profile is not public yet. Complete verification and await compliance
              approval.
            </p>
          ) : (
            <p>
              Your dealer organization is active. Your public profile can be discovered by activated
              pharmacies.
            </p>
          )}
          <Link className="button-link" href="/onboarding">
            {state.kyc.editable ? 'Complete verification' : 'View submission'} →
          </Link>
        </div>
      </main>
    </>
  );
}
