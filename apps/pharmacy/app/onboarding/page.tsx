import { redirect } from 'next/navigation';

import { Brand } from '../../components/brand';
import { LogoutButton } from '../../components/logout-button';
import { OnboardingForm } from '../../components/onboarding-form';
import { readPharmacyKycState, readPharmacySession } from '../../lib/api-server';

export default async function OnboardingPage() {
  const [session, state] = await Promise.all([readPharmacySession(), readPharmacyKycState()]);
  if (!session || !state) redirect('/login');
  return (
    <main className="onboarding-page">
      <header className="account-header">
        <Brand />
        <div className="onboarding-header-actions">
          <a href="/account" className="quiet-link">
            Account overview
          </a>
          <LogoutButton csrfToken={session.csrfToken} />
        </div>
      </header>
      <OnboardingForm initialState={state} csrfToken={session.csrfToken} />
    </main>
  );
}
