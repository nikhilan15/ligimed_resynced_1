import { redirect } from 'next/navigation';
import { idSchema } from '@ligimed/validation';

import { CustomerManager } from '../../components/customer-manager';
import { PharmacyShell } from '../../components/pharmacy-shell';
import { readPharmacyCustomers, readPharmacySession } from '../../lib/api-server';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const query = await searchParams;
  const status = query.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  const cursor = idSchema.safeParse(query.cursor).success ? query.cursor : undefined;
  const [session, customers] = await Promise.all([
    readPharmacySession(),
    readPharmacyCustomers({
      status,
      ...(q ? { q } : {}),
      ...(cursor ? { cursor } : {}),
    }),
  ]);
  if (!session) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  if (!customers) throw new Error('Customer records are unavailable.');
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/customers"
    >
      <main className="marketplace-content customers-page">
        <span className="section-label">PHARMACY CUSTOMERS</span>
        <h1>Customer records</h1>
        <p>
          Keep customer contact details organized for your pharmacy. These records are private to
          your workspace.
        </p>
        <CustomerManager
          customers={customers}
          csrfToken={session.csrfToken}
          query={{ q, status }}
        />
      </main>
    </PharmacyShell>
  );
}
