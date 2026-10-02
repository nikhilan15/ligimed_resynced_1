import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PharmacyShell } from '../../components/pharmacy-shell';
import { readPharmacyMarketplace, readPharmacySession } from '../../lib/api-server';

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const { q, cursor } = await searchParams;
  const [session, marketplace] = await Promise.all([
    readPharmacySession(),
    readPharmacyMarketplace({ ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) }),
  ]);
  if (!session || !marketplace) redirect('/login');

  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/marketplace"
    >
      <main className="marketplace-content">
        <div className="marketplace-heading">
          <div>
            <span className="section-label">LIGIMED MARKETPLACE</span>
            <h1>Verified medicine dealers</h1>
            <p>Discover active distributors with approved LigiMed verification.</p>
          </div>
        </div>

        {marketplace.status === 'LOCKED' ? (
          <section className="marketplace-locked">
            <span aria-hidden="true">✚</span>
            <div>
              <span className="section-label">MARKETPLACE LOCKED</span>
              <h2>Pharmacy activation is required</h2>
              <p>
                Your KYC submission is under review. Dealer information becomes available only after
                your pharmacy is verified and activated.
              </p>
              <Link href="/onboarding">View KYC submission →</Link>
            </div>
          </section>
        ) : (
          <>
            <form className="marketplace-search" action="/marketplace" method="get">
              <label htmlFor="dealer-search">Search dealers or locations</label>
              <div>
                <input
                  id="dealer-search"
                  name="q"
                  defaultValue={q}
                  maxLength={100}
                  placeholder="Dealer name, city or state"
                />
                <button type="submit">Search</button>
              </div>
            </form>

            <div className="marketplace-results-heading">
              <h2>{q ? `Results for “${q}”` : 'Available dealers'}</h2>
              <span>{marketplace.data.dealers.length} shown</span>
            </div>

            {marketplace.data.dealers.length ? (
              <div className="dealer-grid">
                {marketplace.data.dealers.map((dealer) => (
                  <article className="dealer-card" key={dealer.id}>
                    <div className="dealer-card-topline">
                      <span className="dealer-mark" aria-hidden="true">
                        ✚
                      </span>
                      <span className="verified-badge">✓ Verified</span>
                    </div>
                    <h2>{dealer.name}</h2>
                    <p>{dealer.summary ?? 'Verified LigiMed medicine distribution partner.'}</p>
                    <dl>
                      <div>
                        <dt>Location</dt>
                        <dd>
                          {dealer.location.city}, {dealer.location.state}
                        </dd>
                      </div>
                      <div>
                        <dt>Service areas</dt>
                        <dd>{dealer.serviceAreas.join(', ') || 'Contact dealer'}</dd>
                      </div>
                      <div>
                        <dt>Catalogue</dt>
                        <dd>View published listings</dd>
                      </div>
                    </dl>
                    <Link className="catalogue-deferred" href={`/marketplace/dealers/${dealer.id}`}>
                      View dealer catalogue →
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <div className="marketplace-empty">
                <h2>No verified dealers found</h2>
                <p>
                  {q
                    ? 'Try a different dealer name or location.'
                    : 'Verified dealers will appear here when public marketplace profiles are available.'}
                </p>
                {q ? <Link href="/marketplace">Clear search</Link> : null}
              </div>
            )}

            {marketplace.data.page.nextCursor ? (
              <Link
                className="marketplace-next"
                href={{
                  pathname: '/marketplace',
                  query: { ...(q ? { q } : {}), cursor: marketplace.data.page.nextCursor },
                }}
              >
                View more dealers →
              </Link>
            ) : null}
          </>
        )}
      </main>
    </PharmacyShell>
  );
}
