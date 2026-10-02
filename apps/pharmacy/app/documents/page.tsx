import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DocumentFileActions } from '@ligimed/ui';
import {
  documentDefinitions,
  documentListQuerySchema,
  documentStatusSchema,
} from '@ligimed/validation';
import { PharmacyShell } from '../../components/pharmacy-shell';
import { DocumentUpload } from '../../components/document-upload';
import { readDocumentCenter, readPharmacySession } from '../../lib/api-server';
import '@ligimed/ui/document-styles.css';

const groups = [
  ['BUSINESS', 'Business & KYC'],
  ['BANKING', 'Banking'],
  ['TRANSACTIONS', 'Transactions'],
  ['RETURNS', 'Returns'],
  ['FINANCE', 'Finance'],
] as const;
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readPharmacySession();
  if (!session) redirect('/login');
  if (session.access !== 'FULL') redirect('/account');
  const params = await searchParams;
  const raw = Object.fromEntries(
    ['q', 'group', 'status', 'source', 'page', 'orderId', 'invoiceId'].flatMap((key) =>
      typeof params[key] === 'string' ? [[key, params[key]]] : [],
    ),
  );
  const parsed = documentListQuerySchema.safeParse(raw);
  const input = parsed.success ? parsed.data : documentListQuerySchema.parse({});
  const query = new URLSearchParams(
    Object.entries(input).map(([key, value]) => [key, String(value)]),
  );
  const center = await readDocumentCenter(query);
  if (!center) throw new Error('The document center is unavailable.');
  const pageLink = (page: number) => {
    const next = new URLSearchParams(query);
    next.set('page', String(page));
    return `/documents?${next}`;
  };
  return (
    <PharmacyShell
      pharmacyName={session.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/documents"
    >
      <main className="doc-page">
        <header className="doc-heading">
          <div>
            <span className="doc-eyebrow">RECORDS & COMPLIANCE</span>
            <h1>Documents</h1>
            <p className="doc-muted">
              Your business evidence and transaction records, together in one private library.
            </p>
          </div>
          <DocumentUpload csrfToken={session.csrfToken} />
        </header>
        <section className="doc-metrics" aria-label="Document status summary">
          {[
            ['Verified', center.counts.verified, 'VERIFIED'],
            ['Awaiting review', center.counts.pending, 'PENDING_REVIEW'],
            ['Expiring soon', center.counts.expiring, 'EXPIRING_SOON'],
            ['Expired', center.counts.expired, 'EXPIRED'],
            ['Rejected', center.counts.rejected, 'REJECTED'],
          ].map(([title, count, status]) => (
            <Link href={`/documents?status=${status}`} key={title}>
              <span>{title}</span>
              <strong>{count}</strong>
              <small>View documents →</small>
            </Link>
          ))}
        </section>
        {center.reminders.length ? (
          <section className="doc-alerts">
            <div>
              <span className="doc-eyebrow">NEEDS ATTENTION</span>
              <h2>Upcoming renewals</h2>
            </div>
            <ul>
              {center.reminders.slice(0, 5).map((item) => (
                <li key={`${item.source}-${item.id}`}>
                  <Link href={item.source === 'UPLOAD' ? `/documents/${item.id}` : '/onboarding'}>
                    {item.title}
                  </Link>
                  <span>
                    {item.daysRemaining < 0
                      ? `Expired ${Math.abs(item.daysRemaining)} days ago`
                      : item.daysRemaining === 0
                        ? 'Expires today'
                        : `Expires in ${item.daysRemaining} days`}
                  </span>
                  <time>{item.expiresAt}</time>
                </li>
              ))}
            </ul>
            <p className="doc-muted">
              Reminder windows: {center.thresholds.join(', ')} days before expiry. Updating a
              document does not automatically re-approve your pharmacy.
            </p>
          </section>
        ) : null}
        <section className="doc-checklist">
          <h2>Business evidence</h2>
          <div>
            {center.checklist.map((item) => (
              <div key={item.category}>
                <span>{documentDefinitions.find(([key]) => key === item.category)?.[1]}</span>
                <span className={`doc-status status-${item.status.toLowerCase()}`}>
                  {label(item.status)}
                </span>
              </div>
            ))}
          </div>
          <p className="doc-muted">
            A completeness checklist, not a legal determination of which documents your business
            must supply.
          </p>
        </section>
        <section className="doc-library">
          <div className="doc-heading">
            <h2>Document library</h2>
            <span className="doc-muted">{center.page.total} records</span>
          </div>
          <nav className="doc-tabs" aria-label="Document groups">
            <Link href="/documents" aria-current={!input.group ? 'page' : undefined}>
              All documents
            </Link>
            {groups.map(([key, title]) => (
              <Link
                key={key}
                href={`/documents?group=${key}`}
                aria-current={input.group === key ? 'page' : undefined}
              >
                {title}
              </Link>
            ))}
          </nav>
          <form className="doc-filters" method="get">
            {input.orderId ? <input type="hidden" name="orderId" value={input.orderId} /> : null}
            {input.invoiceId ? (
              <input type="hidden" name="invoiceId" value={input.invoiceId} />
            ) : null}
            <label className="doc-search">
              Search
              <input
                name="q"
                defaultValue={input.q ?? ''}
                placeholder="Title, reference or file name"
                maxLength={100}
              />
            </label>
            <label>
              Category group
              <select name="group" defaultValue={input.group ?? ''}>
                <option value="">All groups</option>
                {groups.map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={input.status ?? ''}>
                <option value="">All statuses</option>
                {documentStatusSchema.options
                  .filter((status) => status !== 'NOT_UPLOADED')
                  .map((status) => (
                    <option key={status} value={status}>
                      {label(status)}
                    </option>
                  ))}
              </select>
            </label>
            <button className="doc-secondary">Apply</button>
            <Link href="/documents">Reset</Link>
          </form>
          {center.documents.length ? (
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Status</th>
                    <th>Expiry / date</th>
                    <th>Linked record</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {center.documents.map((item) => (
                    <tr key={`${item.source}-${item.id}`}>
                      <td>
                        <Link
                          href={
                            item.source === 'UPLOAD'
                              ? `/documents/${item.id}`
                              : (item.viewPath ?? '/documents')
                          }
                        >
                          <strong>{item.title}</strong>
                        </Link>
                        <small>
                          {documentDefinitions.find(([key]) => key === item.category)?.[1]} ·{' '}
                          {item.source === 'UPLOAD' ? item.originalFilename : label(item.source)}
                          {item.referenceNumber ? ` · ${item.referenceNumber}` : ''}
                        </small>
                      </td>
                      <td>
                        <span className={`doc-status status-${item.status.toLowerCase()}`}>
                          {label(item.status)}
                        </span>
                        {item.rejectionReason ? (
                          <small className="doc-error">{item.rejectionReason}</small>
                        ) : null}
                      </td>
                      <td>
                        <time>
                          {item.expiresAt ?? item.issuedAt ?? item.createdAt.slice(0, 10)}
                        </time>
                      </td>
                      <td>
                        {item.invoiceId ? (
                          <Link href={`/billing/${item.invoiceId}`}>Invoice →</Link>
                        ) : item.orderId ? (
                          <Link href={`/orders/${item.orderId}`}>Order →</Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <DocumentFileActions
                          url={`/api/documents/${item.source.toLowerCase()}/${item.id}/content`}
                          filename={
                            item.originalFilename ?? `${item.source.toLowerCase()}-${item.id}.pdf`
                          }
                          sensitive={item.sensitive}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="doc-empty">
              <span className="doc-empty-icon">▤</span>
              <h3>No documents here yet</h3>
              <p>
                Upload a genuine record or change your filters. Orders, bills and payment entries
                appear here when recorded.
              </p>
            </div>
          )}
          <div className="doc-pagination">
            <span>
              Page {center.page.current} of {center.page.totalPages}
            </span>
            <div>
              {input.page > 1 ? <Link href={pageLink(input.page - 1)}>← Previous</Link> : null}
              {input.page < center.page.totalPages ? (
                <Link href={pageLink(input.page + 1)}>Next →</Link>
              ) : null}
            </div>
          </div>
        </section>
        <p className="doc-footnote">
          Private access · Download actions are audited · No disposal certificates or credit
          agreements are generated automatically.
        </p>
      </main>
    </PharmacyShell>
  );
}
