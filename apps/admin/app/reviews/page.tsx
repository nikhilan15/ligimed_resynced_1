import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminShell } from '../../components/admin-shell';
import { readAdminKycQueue, readAdminSession } from '../../lib/api-server';

export default async function AdminReviewsPage() {
  const [session, queue] = await Promise.all([readAdminSession(), readAdminKycQueue()]);
  if (!session || !queue) redirect('/login');
  return (
    <AdminShell displayName={session.user.displayName} csrfToken={session.csrfToken}>
      <main className="admin-content">
        <span className="admin-label">COMPLIANCE QUEUE</span>
        <h1>KYC review</h1>
        <p className="admin-intro">
          Review submitted pharmacy and dealer evidence before activation.
        </p>
        <div className="admin-queue-meta">
          <span>
            {queue.records.length} record{queue.records.length === 1 ? '' : 's'}
          </span>
          <span>All actions are audited</span>
        </div>
        {queue.records.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Submitted</th>
                  <th>Evidence</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.records.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.organization.name}</strong>
                      <small>
                        {record.organization.type} · Revision {record.revision}
                      </small>
                    </td>
                    <td>{new Date(record.submittedAt).toLocaleDateString('en-IN')}</td>
                    <td>
                      {record.evidenceCount} document{record.evidenceCount === 1 ? '' : 's'}
                    </td>
                    <td>
                      <span className={`admin-status status-${record.status.toLowerCase()}`}>
                        {record.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <Link href={`/reviews/${record.id}`}>Open review →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">
            <h2>Queue is clear</h2>
            <p>No submitted KYC records are waiting for review.</p>
          </div>
        )}
      </main>
    </AdminShell>
  );
}
