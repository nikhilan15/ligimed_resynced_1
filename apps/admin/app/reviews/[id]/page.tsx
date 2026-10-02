import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { idSchema } from '@ligimed/validation';

import { AdminShell } from '../../../components/admin-shell';
import { ReviewActions } from '../../../components/review-actions';
import { readAdminKycReview, readAdminSession } from '../../../lib/api-server';

export default async function AdminReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const [session, record] = await Promise.all([readAdminSession(), readAdminKycReview(id)]);
  if (!session) redirect('/login');
  if (!record || record === 'NOT_FOUND') notFound();
  return (
    <AdminShell displayName={session.user.displayName} csrfToken={session.csrfToken}>
      <main className="admin-content review-detail">
        <Link className="admin-back-link" href="/reviews">
          ← Back to queue
        </Link>
        <div className="review-heading">
          <div>
            <span className="admin-label">
              {record.organization.type} KYC · REVISION {record.revision}
            </span>
            <h1>{record.organization.name}</h1>
            <p>Submitted {new Date(record.submittedAt).toLocaleString('en-IN')}</p>
          </div>
          <span className={`admin-status status-${record.status.toLowerCase()}`}>
            {record.status.replace('_', ' ')}
          </span>
        </div>
        <div className="review-grid">
          <section className="review-card">
            <span className="admin-label">ORGANIZATION PROFILE</span>
            <h2>Organization details</h2>
            <dl>
              <div>
                <dt>Legal name</dt>
                <dd>{record.profile.legalName}</dd>
              </div>
              <div>
                <dt>Trade name</dt>
                <dd>{record.profile.tradeName ?? '—'}</dd>
              </div>
              <div>
                <dt>Representative</dt>
                <dd>
                  {record.representativeName}
                  {record.representativeRole ? ` · ${record.representativeRole}` : ''}
                </dd>
              </div>
              <div>
                <dt>Operational email</dt>
                <dd>{record.profile.operationalEmail ?? '—'}</dd>
              </div>
              {record.organization.type === 'DEALER' && (
                <>
                  <div>
                    <dt>Public summary</dt>
                    <dd>{record.profile.summary ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Service areas</dt>
                    <dd>{record.profile.serviceAreas.join(', ') || '—'}</dd>
                  </div>
                </>
              )}
            </dl>
          </section>
          <section className="review-card">
            <span className="admin-label">PRIMARY ADDRESS</span>
            <h2>Delivery location</h2>
            {record.profile.address ? (
              <address>
                {record.profile.address.name}
                <br />
                {record.profile.address.line1}
                <br />
                {record.profile.address.line2 ? (
                  <>
                    {record.profile.address.line2}
                    <br />
                  </>
                ) : null}
                {record.profile.address.city}, {record.profile.address.district}
                <br />
                {record.profile.address.state} {record.profile.address.postalCode}
              </address>
            ) : (
              <p>Address not supplied.</p>
            )}
          </section>
          <section className="review-card review-evidence">
            <span className="admin-label">SUPPORTING EVIDENCE</span>
            <h2>
              {record.evidence.length} document{record.evidence.length === 1 ? '' : 's'}
            </h2>
            <ul>
              {record.evidence.map((evidence) => (
                <li key={evidence.id}>
                  <div>
                    <strong>{evidence.category.replace('_', ' ')}</strong>
                    <small>
                      {evidence.originalFilename}
                      {evidence.referenceNumber ? ` · ${evidence.referenceNumber}` : ''}
                    </small>
                  </div>
                  <a href={`/api/admin-reviews/kyc/${record.id}/evidence/${evidence.id}/content`}>
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <ReviewActions
            recordId={record.id}
            status={record.status}
            csrfToken={session.csrfToken}
          />
        </div>
      </main>
    </AdminShell>
  );
}
