import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { idSchema } from '@ligimed/validation';
import { DocumentFileActions } from '@ligimed/ui';
import { AdminShell } from '../../../components/admin-shell';
import { DocumentReview } from '../../../components/document-review';
import { readAdminDocument, readAdminSession } from '../../../lib/api-server';
import '@ligimed/ui/document-styles.css';
import '../review.css';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await readAdminSession();
  if (!session) redirect('/login');
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const doc = await readAdminDocument(parsed.data);
  if (!doc) throw new Error('Document review is unavailable.');
  if (doc === 'NOT_FOUND') notFound();
  return (
    <AdminShell
      displayName={session.user.displayName}
      csrfToken={session.csrfToken}
      activePath="/documents"
    >
      <main className="doc-page">
        <Link href="/documents" className="doc-back">
          ← Document queue
        </Link>
        <header className="doc-heading">
          <div>
            <span className="doc-eyebrow">PRIVATE EVIDENCE</span>
            <h1>{doc.title}</h1>
            <span className={`doc-status status-${doc.status.toLowerCase()}`}>
              {doc.status.toLowerCase().replaceAll('_', ' ')}
            </span>
          </div>
          <DocumentFileActions
            url={`/api/documents/upload/${doc.id}/content`}
            filename={doc.originalFilename ?? 'document.pdf'}
            sensitive
          />
        </header>
        <section className="doc-detail-card">
          <h2>Submitted details</h2>
          <dl className="doc-details">
            {[
              ['File', doc.originalFilename],
              ['Category', doc.category.toLowerCase().replaceAll('_', ' ')],
              ['Reference', doc.referenceNumber],
              ['Holder', doc.holderName],
              ['Licence type', doc.licenceType],
              ['Designation', doc.designation],
              ['Issued', doc.issuedAt],
              ['Expires', doc.expiresAt],
              ['Review state', doc.reviewStatus.toLowerCase().replaceAll('_', ' ')],
              ['Bank account', doc.bankAccountLast4 ? `•••• ${doc.bankAccountLast4}` : null],
              ['IFSC', doc.bankIfsc],
            ]
              .filter(([, value]) => value)
              .map(([title, value]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {doc.rejectionReason ? <p className="doc-error">{doc.rejectionReason}</p> : null}
        </section>
        <DocumentReview document={doc} csrfToken={session.csrfToken} />
        <div className="doc-detail-grid">
          <section className="doc-detail-card">
            <h2>Verification history</h2>
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
            {!doc.reviews.length ? <p className="doc-muted">No review decisions yet.</p> : null}
          </section>
          <section className="doc-detail-card">
            <h2>Original versions</h2>
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
          </section>
        </div>
      </main>
    </AdminShell>
  );
}
