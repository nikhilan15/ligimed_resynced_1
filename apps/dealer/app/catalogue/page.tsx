import { dealerCatalogueQuerySchema } from '@ligimed/validation';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CatalogueManager } from '../../components/catalogue-manager';
import { DealerHeader } from '../../components/dealer-header';
import { readDealerCatalogue, readDealerSession } from '../../lib/api-server';

export default async function DealerCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; availability?: string; cursor?: string }>;
}) {
  const raw = await searchParams;
  const parsed = dealerCatalogueQuerySchema.safeParse({ ...raw, limit: 20 });
  if (!parsed.success) notFound();
  const query = parsed.data;
  const [session, catalogue] = await Promise.all([
    readDealerSession(),
    readDealerCatalogue({
      ...(query.q ? { q: query.q } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      availability: query.availability,
    }),
  ]);
  if (!session) redirect('/login');
  if (session.access !== 'FULL' || !catalogue) redirect('/account');

  return (
    <>
      <DealerHeader name={session.dealer.name} csrfToken={session.csrfToken} />
      <main className="catalogue-page">
        <span className="eyebrow">DEALER CATALOGUE</span>
        <h1>Publish medicines</h1>
        <p>Manage the medicines visible to verified and activated pharmacies.</p>
        <form className="catalogue-search" method="get">
          <label>
            Search catalogue
            <input name="q" defaultValue={query.q ?? ''} placeholder="Medicine, generic or SKU" />
          </label>
          <label>
            Publication status
            <select name="availability" defaultValue={query.availability}>
              <option value="ALL">All listings</option>
              <option value="AVAILABLE">Published</option>
              <option value="UNAVAILABLE">Unpublished</option>
            </select>
          </label>
          <button>Apply filters</button>
          <Link href="/catalogue">Clear</Link>
        </form>
        <CatalogueManager csrfToken={session.csrfToken} products={catalogue.products} />
        {catalogue.page.nextCursor ? (
          <Link
            className="button-link"
            href={{
              pathname: '/catalogue',
              query: {
                ...(query.q ? { q: query.q } : {}),
                availability: query.availability,
                cursor: catalogue.page.nextCursor,
              },
            }}
          >
            View more listings →
          </Link>
        ) : null}
      </main>
    </>
  );
}
