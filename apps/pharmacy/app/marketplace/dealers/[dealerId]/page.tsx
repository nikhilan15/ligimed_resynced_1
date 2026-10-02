import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { idSchema, pharmacyCatalogueQuerySchema } from '@ligimed/validation';

import { PharmacyShell } from '../../../../components/pharmacy-shell';
import { readPharmacyDealerCatalogue, readPharmacySession } from '../../../../lib/api-server';

function price(amountMinor: string, currency: string) {
  const minor = BigInt(amountMinor);
  const whole = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, '0');
  const amount = `${new Intl.NumberFormat('en-IN').format(whole)}.${fraction}`;
  return currency === 'INR' ? `₹${amount}` : `${currency} ${amount}`;
}

export default async function DealerCataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ dealerId: string }>;
  searchParams: Promise<{
    q?: string;
    category?: string;
    manufacturer?: string;
    dosageForm?: string;
    cursor?: string;
  }>;
}) {
  const [{ dealerId }, rawQuery] = await Promise.all([params, searchParams]);
  if (!idSchema.safeParse(dealerId).success) notFound();
  const parsed = pharmacyCatalogueQuerySchema.safeParse(rawQuery);
  if (!parsed.success) notFound();
  const query = parsed.data;
  const [session, result] = await Promise.all([
    readPharmacySession(),
    readPharmacyDealerCatalogue(dealerId, {
      ...(query.q ? { q: query.q } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.manufacturer ? { manufacturer: query.manufacturer } : {}),
      ...(query.dosageForm ? { dosageForm: query.dosageForm } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    }),
  ]);
  if (!session || !result) redirect('/login');
  if (result.status === 'NOT_FOUND') notFound();

  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/marketplace"
    >
      <main className="marketplace-content dealer-detail-page">
        <Link className="marketplace-next" href="/marketplace">
          ← All verified dealers
        </Link>
        {result.status === 'LOCKED' ? (
          <section className="marketplace-locked">
            <span aria-hidden="true">✚</span>
            <div>
              <span className="section-label">MARKETPLACE LOCKED</span>
              <h1>Pharmacy activation is required</h1>
              <p>Dealer catalogues are available after your pharmacy is approved and activated.</p>
              <Link href="/onboarding">View KYC status →</Link>
            </div>
          </section>
        ) : (
          <>
            <header className="dealer-detail-header">
              <span className="section-label">VERIFIED DISTRIBUTOR</span>
              <h1>{result.data.dealer.name}</h1>
              <p>
                {result.data.dealer.summary ?? 'Verified LigiMed medicine distribution partner.'}
              </p>
              <div className="dealer-detail-facts">
                <span>
                  <strong>Location</strong> {result.data.dealer.location.city},{' '}
                  {result.data.dealer.location.state}
                </span>
                <span>
                  <strong>Service areas</strong>{' '}
                  {result.data.dealer.serviceAreas.join(', ') || 'Contact dealer'}
                </span>
              </div>
            </header>
            <form className="marketplace-search catalogue-filter-form" method="get">
              <label htmlFor="catalogue-search">Search this dealer&apos;s catalogue</label>
              <div>
                <input
                  id="catalogue-search"
                  name="q"
                  defaultValue={query.q ?? ''}
                  maxLength={100}
                  placeholder="Medicine, generic name or manufacturer"
                />
                <button type="submit">Search</button>
              </div>
              <div className="catalogue-filters">
                <label>
                  Category
                  <select name="category" defaultValue={query.category ?? ''}>
                    <option value="">All categories</option>
                    {result.data.filters.categories.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Manufacturer
                  <select name="manufacturer" defaultValue={query.manufacturer ?? ''}>
                    <option value="">All manufacturers</option>
                    {result.data.filters.manufacturers.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Dosage form
                  <select name="dosageForm" defaultValue={query.dosageForm ?? ''}>
                    <option value="">All forms</option>
                    {result.data.filters.dosageForms.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <Link href={`/marketplace/dealers/${dealerId}`}>Clear filters</Link>
              </div>
            </form>
            <div className="marketplace-results-heading">
              <h2>{query.q ? `Catalogue results for “${query.q}”` : 'Published catalogue'}</h2>
              <span>{result.data.products.length} shown</span>
            </div>
            {result.data.products.length ? (
              <div className="catalogue-grid">
                {result.data.products.map((product) => (
                  <article className="catalogue-card" key={product.listingId}>
                    <span className="section-label">{product.category ?? 'MEDICINE'}</span>
                    <h3>{product.name}</h3>
                    {product.genericName ? <p>{product.genericName}</p> : null}
                    <dl>
                      {product.strength ? (
                        <div>
                          <dt>Strength</dt>
                          <dd>{product.strength}</dd>
                        </div>
                      ) : null}
                      {product.dosageForm ? (
                        <div>
                          <dt>Form</dt>
                          <dd>{product.dosageForm}</dd>
                        </div>
                      ) : null}
                      {product.packSize ? (
                        <div>
                          <dt>Pack</dt>
                          <dd>{product.packSize}</dd>
                        </div>
                      ) : null}
                      {product.manufacturer ? (
                        <div>
                          <dt>Manufacturer</dt>
                          <dd>{product.manufacturer}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="catalogue-price">
                      <strong>
                        {price(product.unitPrice.amountMinor, product.unitPrice.currency)}
                      </strong>
                      <span>Minimum order: {product.minimumQuantity}</span>
                    </div>
                    <Link
                      className="catalogue-details-link"
                      href={`/marketplace/dealers/${dealerId}/products/${product.listingId}`}
                    >
                      View medicine details →
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <div className="marketplace-empty">
                <h2>No published listings found</h2>
                <p>
                  {query.q
                    ? 'Try a different product or manufacturer name.'
                    : 'This dealer has not published any catalogue listings yet.'}
                </p>
                {query.q ? (
                  <Link href={`/marketplace/dealers/${dealerId}`}>Clear search</Link>
                ) : null}
              </div>
            )}
            {result.data.page.nextCursor ? (
              <Link
                className="marketplace-next"
                href={{
                  pathname: `/marketplace/dealers/${dealerId}`,
                  query: {
                    ...(query.q ? { q: query.q } : {}),
                    ...(query.category ? { category: query.category } : {}),
                    ...(query.manufacturer ? { manufacturer: query.manufacturer } : {}),
                    ...(query.dosageForm ? { dosageForm: query.dosageForm } : {}),
                    cursor: result.data.page.nextCursor,
                  },
                }}
              >
                View more listings →
              </Link>
            ) : null}
          </>
        )}
      </main>
    </PharmacyShell>
  );
}
