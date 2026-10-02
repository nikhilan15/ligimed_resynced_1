import { idSchema } from '@ligimed/validation';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PharmacyShell } from '../../../../../../components/pharmacy-shell';
import { AddToCartForm } from '../../../../../../components/add-to-cart-form';
import {
  readPharmacyCatalogueListing,
  readPharmacySession,
} from '../../../../../../lib/api-server';

function price(amountMinor: string, currency: string) {
  const minor = BigInt(amountMinor);
  const whole = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, '0');
  const amount = `${new Intl.NumberFormat('en-IN').format(whole)}.${fraction}`;
  return currency === 'INR' ? `₹${amount}` : `${currency} ${amount}`;
}

export default async function MedicineDetailPage({
  params,
}: {
  params: Promise<{ dealerId: string; listingId: string }>;
}) {
  const { dealerId, listingId } = await params;
  if (!idSchema.safeParse(dealerId).success || !idSchema.safeParse(listingId).success) notFound();
  const [session, result] = await Promise.all([
    readPharmacySession(),
    readPharmacyCatalogueListing(dealerId, listingId),
  ]);
  if (!session || !result) redirect('/login');
  if (result.status === 'NOT_FOUND') notFound();
  if (result.status === 'LOCKED') redirect('/marketplace');
  const product = result.data.product;

  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/marketplace"
    >
      <main className="marketplace-content medicine-detail-page">
        <Link className="marketplace-next" href={`/marketplace/dealers/${dealerId}`}>
          ← {result.data.dealer.name} catalogue
        </Link>
        <article className="medicine-detail-card">
          <span className="section-label">{product.category ?? 'MEDICINE'}</span>
          <h1>{product.name}</h1>
          {product.genericName ? <p className="medicine-generic">{product.genericName}</p> : null}
          <p>
            {product.description ??
              'The dealer has not provided an additional product description. Confirm product and regulatory details before ordering.'}
          </p>
          <dl className="medicine-facts">
            <div>
              <dt>Manufacturer</dt>
              <dd>{product.manufacturer ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Strength</dt>
              <dd>{product.strength ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Dosage form</dt>
              <dd>{product.dosageForm ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Pack size</dt>
              <dd>{product.packSize ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Dealer SKU</dt>
              <dd>{product.sku ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Minimum order</dt>
              <dd>{product.minimumQuantity}</dd>
            </div>
          </dl>
          <div className="medicine-price">
            <span>Dealer price</span>
            <strong>{price(product.unitPrice.amountMinor, product.unitPrice.currency)}</strong>
          </div>
          <AddToCartForm
            csrfToken={session.csrfToken}
            listingId={product.listingId}
            minimumQuantity={product.minimumQuantity}
          />
          <p className="medicine-compliance-note">
            Product information is dealer-supplied. Prescription, storage, sale and regulatory
            requirements must be validated through qualified compliance review.
          </p>
        </article>
      </main>
    </PharmacyShell>
  );
}
