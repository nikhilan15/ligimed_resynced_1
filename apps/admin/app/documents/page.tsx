import Link from 'next/link';
import { redirect } from 'next/navigation';
import { documentListQuerySchema, documentStatusSchema } from '@ligimed/validation';
import { AdminShell } from '../../components/admin-shell';
import { DocumentReminderPolicy } from '../../components/document-reminder-policy';
import { readAdminDocuments, readAdminSession } from '../../lib/api-server';
import '@ligimed/ui/document-styles.css';
import './review.css';

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readAdminSession();
  if (!session) redirect('/login');
  const params = await searchParams;
  const raw = Object.fromEntries(
    ['q', 'status', 'page'].flatMap((key) =>
      typeof params[key] === 'string' ? [[key, params[key]]] : [],
    ),
  );
  const parsed = documentListQuerySchema.safeParse(raw);
  const input = parsed.success ? parsed.data : documentListQuerySchema.parse({});
  const query = new URLSearchParams(
    Object.entries(input).map(([key, value]) => [key, String(value)]),
  );
  const center = await readAdminDocuments(query);
  if (!center) throw new Error('Document review service is unavailable.');
  const pageLink = (page: number) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/documents?${next}`;
  };
  return (
    <AdminShell
      displayName={session.user.displayName}
      csrfToken={session.csrfToken}
      activePath="/documents"
    >
      <main className="doc-page">
        <header className="doc-heading">
          <div>
            <span className="doc-eyebrow">COMPLIANCE WORKSPACE</span>
            <h1>Pharmacy documents</h1>
            <p className="doc-muted">
              Review original uploads, track expiry, and request corrections without changing the
              evidence.
            </p>
          </div>
          <Link className="doc-secondary" href="/reviews">
            KYC & activation queue →
          </Link>
        </header>
        <DocumentReminderPolicy csrfToken={session.csrfToken} thresholds={center.thresholds} />
        <section className="doc-library">
          <form className="doc-filters" method="get">
            <label className="doc-search">
              Search documents
              <input
                name="q"
                maxLength={100}
                defaultValue={input.q ?? ''}
                placeholder="Title, number or filename"
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={input.status ?? ''}>
                <option value="">All statuses</option>
                {documentStatusSchema.options
                  .filter((value) => !['RECORDED', 'NOT_UPLOADED'].includes(value))
                  .map((value) => (
                    <option value={value} key={value}>
                      {value.toLowerCase().replaceAll('_', ' ')}
                    </option>
                  ))}
              </select>
            </label>
            <button className="doc-primary">Apply</button>
            <Link href="/documents">Reset</Link>
          </form>
          {center.documents.length ? (
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Pharmacy / document</th>
                    <th>Review</th>
                    <th>Expiry</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {center.documents.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.organizationName}</strong>
                        <small>
                          {item.title} · {item.originalFilename}
                        </small>
                      </td>
                      <td>
                        <span className={`doc-status status-${item.status.toLowerCase()}`}>
                          {item.status.toLowerCase().replaceAll('_', ' ')}
                        </span>
                      </td>
                      <td>{item.expiresAt ?? '—'}</td>
                      <td>
                        <Link href={`/documents/${item.id}`}>Open review →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="doc-empty">
              <h3>No matching pharmacy uploads</h3>
              <p>
                Initial KYC evidence is reviewed in the KYC queue. Additional documents appear here
                after upload.
              </p>
            </div>
          )}
          <div className="doc-pagination">
            <span>
              {center.page.total} documents · Page {center.page.current} of {center.page.totalPages}
            </span>
            <div>
              {input.page > 1 ? <Link href={pageLink(input.page - 1)}>← Previous</Link> : null}
              {input.page < center.page.totalPages ? (
                <Link href={pageLink(input.page + 1)}>Next →</Link>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </AdminShell>
  );
}
