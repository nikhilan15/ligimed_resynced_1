import { redirect } from 'next/navigation';
import { Brand } from '../../components/brand';
import { LogoutButton } from '../../components/logout-button';
import { readPharmacySession } from '../../lib/api-server';

export default async function AccountPage() {
  const session = await readPharmacySession();
  if (!session) redirect('/login');
  return (
    <main className="account-page">
      <header className="account-header">
        <Brand />
        <LogoutButton csrfToken={session.csrfToken} />
      </header>
      <section className="account-content">
        <span className="section-label">YOUR PHARMACY ACCOUNT</span>
        <h1>Welcome, {session.user.displayName ?? 'pharmacy partner'}.</h1>
        <p>You’re securely signed in to {session.pharmacy.name}.</p>
        <div className="account-card">
          <div className="account-card-heading">
            <span className="account-cross" aria-hidden="true">
              ✚
            </span>
            <div>
              <h2>{session.pharmacy.name}</h2>
              <span className="account-badge">
                {session.pharmacy.status === 'PENDING' ? 'Verification pending' : 'Account active'}
              </span>
            </div>
          </div>
          <dl>
            <div>
              <dt>Account authentication</dt>
              <dd>Complete</dd>
            </div>
            <div>
              <dt>Account access</dt>
              <dd>{session.access === 'ONBOARDING' ? 'Account setup only' : 'Pharmacy member'}</dd>
            </div>
          </dl>
          <div className="next-step">
            <span className="section-label">WHAT’S NEXT</span>
            <h3>Get your pharmacy ready.</h3>
            <p>
              Complete your pharmacy profile and submit supporting evidence for review. Your draft
              is saved so you can safely sign out and return.
            </p>
            <a className="primary-action account-cta" href="/onboarding">
              {session.pharmacy.status === 'PENDING'
                ? 'Continue onboarding'
                : 'View pharmacy profile'}
              <span>→</span>
            </a>
            <a className="quiet-link account-dashboard-link" href="/dashboard">
              Open pharmacy dashboard →
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
