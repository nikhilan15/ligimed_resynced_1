import { redirect } from 'next/navigation';

import { DealerHeader } from '../../components/dealer-header';
import { DealerOnboardingForm } from '../../components/dealer-onboarding-form';
import { readDealerKycState, readDealerSession } from '../../lib/api-server';

export default async function DealerOnboarding() {
  const [session, state] = await Promise.all([readDealerSession(), readDealerKycState()]);
  if (!session || !state) redirect('/login');
  return (
    <>
      <DealerHeader name={session.dealer.name} csrfToken={session.csrfToken} />
      <DealerOnboardingForm initialState={state} csrfToken={session.csrfToken} />
    </>
  );
}
