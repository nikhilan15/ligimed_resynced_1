import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DocumentFileActions } from '@ligimed/ui';
import { idSchema } from '@ligimed/validation';
import { PharmacyShell } from '../../../components/pharmacy-shell';
import { DocumentUpload } from '../../../components/document-upload';
import { readDocumentDetail, readPharmacySession } from '../../../lib/api-server';
import '@ligimed/ui/document-styles.css';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await readPharmacySession();
  if (!session) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const doc = await readDocumentDetail(parsed.data);
  if (!doc) throw new Error('Document service is unavailable.');
  if (doc === 'NOT_FOUND') notFound();
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/documents"
    >
      <main className="doc-page">
        <Link href="/documents" className="doc-back">
          ← Document library
        </Link>
        <header className="doc-heading">
          <div>
            <span className="doc-eyebrow">{doc.group.replaceAll('_', ' ')}</span>
            <h1>{doc.title}</h1>
            <span className={`doc-status status-${doc.status.toLowerCase()}`}>
              {doc.status.toLowerCase().replaceAll('_', ' ')}
            </span>
          </div>
          {!doc.superseded ? (
            <DocumentUpload csrfToken={session.csrfToken} replacement={doc} />
          ) : (
            <span className="doc-muted">Replaced by a newer version</span>
          )}
        </header>
        {doc.rejectionReason ? (
          <div className="doc-error doc-callout">
            <strong>Re-upload requested</strong>
            <p>{doc.rejectionReason}</p>
            <p>
              Upload a corrected replacement. Your original and the review decision remain in the
              record.
            </p>
          </div>
        ) : null}
        <section className="doc-detail-card">
          <h2>Document details</h2>
          <dl className="doc-details">
            {[
              ['File', doc.originalFilename],
              ['Reference', doc.referenceNumber],
              ['Holder', doc.holderName],
              ['Licence type', doc.licenceType],
              ['Designation', doc.designation],
              ['Issued', doc.issuedAt],
              ['Expires', doc.expiresAt],
              ['Review status', doc.reviewStatus.toLowerCase().replaceAll('_', ' ')],
              ['Account', doc.bankAccountLast4 ? `•••• ${doc.bankAccountLast4}` : null],
              ['IFSC', doc.bankIfsc],
              ['Uploaded', new Date(doc.createdAt).toLocaleString('en-IN')],
            ]
              .filter(([, value]) => value)
              .map(([title, value]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          <DocumentFileActions
            url={`/api/documents/upload/${doc.id}/content`}
            filename={doc.originalFilename ?? 'document.pdf'}
            sensitive={doc.sensitive}
          />
          {doc.orderId ? (
            <p>
              <Link href={`/orders/${doc.orderId}`}>Linked order →</Link>
            </p>
          ) : null}
          {doc.invoiceId ? (
            <p>
              <Link href={`/billing/${doc.invoiceId}`}>Linked invoice →</Link>
            </p>
          ) : null}
        </section>
        <div className="doc-detail-grid">
          <section className="doc-detail-card">
            <h2>Verification history</h2>
            {doc.reviews.length ? (
              <ol className="doc-timeline">
                {doc.reviews.map((review) => (
                  <li key={review.id}>
                    <strong>{review.status.toLowerCase().replaceAll('_', ' ')}</strong>
                    <small>
                      {review.reviewerName ?? 'Compliance reviewer'} ·{' '}
                      {new Date(review.createdAt).toLocaleString('en-IN')}
                    </small>
                    {review.reason ? <p>{review.reason}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="doc-muted">Waiting for a compliance reviewer.</p>
            )}
          </section>
          <section className="doc-detail-card">
            <h2>Version history</h2>
            <ol className="doc-timeline">
              {doc.versions.map((version) => (
                <li key={version.id}>
                  <Link href={`/documents/${version.id}`}>{version.title}</Link>
                  <small>
                    {new Date(version.createdAt).toLocaleString('en-IN')} ·{' '}
                    {version.reviewStatus.toLowerCase().replaceAll('_', ' ')}
                  </small>
                </li>
              ))}
            </ol>
            <p className="doc-muted">Original files are retained and cannot be silently edited.</p>
          </section>
        </div>
      </main>
    </PharmacyShell>
  );
}
