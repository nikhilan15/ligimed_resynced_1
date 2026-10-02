import { redirect } from 'next/navigation';

import { PharmacyShell } from '../../components/pharmacy-shell';
import { readPharmacyDashboard, readPharmacySession } from '../../lib/api-server';

const metricLabels = {
  todaysOrders: "Today's orders",
  pendingOrders: 'Pending orders',
  completedOrders: 'Completed orders',
  inventoryValue: 'Inventory value',
  lowStockProducts: 'Low-stock products',
  nearExpiryProducts: 'Near-expiry products',
  outstandingPayments: 'Outstanding payments',
} as const;

const actionCopy = {
  COMPLETE_KYC: {
    title: 'Complete your pharmacy verification',
    body: 'Add your profile and supporting evidence before the account can be reviewed.',
    link: 'Continue verification',
  },
  AWAIT_REVIEW: {
    title: 'Your KYC is under review',
    body: 'Your submission is safely locked. Full marketplace access starts after an authorized review and account activation.',
    link: 'View submission',
  },
  RESOLVE_REJECTION: {
    title: 'Your KYC needs attention',
    body: 'Review the feedback and submit a new evidence revision.',
    link: 'Resolve verification',
  },
  AWAIT_ACTIVATION: {
    title: 'Verification complete; activation pending',
    body: 'Your pharmacy is verified. Sign in again after the account has been activated.',
    link: 'View profile',
  },
  NONE: {
    title: 'Your pharmacy workspace is ready',
    body: 'New operational modules will appear here as each verified release is completed.',
    link: 'View profile',
  },
} as const;

export default async function DashboardPage() {
  const [session, dashboard] = await Promise.all([readPharmacySession(), readPharmacyDashboard()]);
  if (!session || !dashboard) redirect('/login');
  const copy = actionCopy[dashboard.onboarding.action];

  return (
    <PharmacyShell
      pharmacyName={dashboard.pharmacy.name}
      csrfToken={session.csrfToken}
      activePath="/dashboard"
    >
      <main className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <span className="section-label">PHARMACY DASHBOARD</span>
            <h1>Good day, {dashboard.user.displayName ?? 'pharmacy partner'}.</h1>
            <p>A clear view of your LigiMed pharmacy workspace.</p>
          </div>
          <span className={`dashboard-access access-${dashboard.access.toLowerCase()}`}>
            {dashboard.access === 'FULL' ? 'Active account' : 'Limited access'}
          </span>
        </div>

        <section className="dashboard-status" aria-labelledby="dashboard-status-title">
          <div>
            <span className="section-label">ACCOUNT STATUS</span>
            <h2 id="dashboard-status-title">{copy.title}</h2>
            <p>{copy.body}</p>
            {dashboard.onboarding.submittedAt ? (
              <small>
                Submitted {new Date(dashboard.onboarding.submittedAt).toLocaleDateString('en-IN')}
              </small>
            ) : null}
          </div>
          <a href="/onboarding">{copy.link} →</a>
        </section>

        <section aria-labelledby="operational-overview-title">
          <div className="dashboard-section-heading">
            <div>
              <span className="section-label">OPERATIONS</span>
              <h2 id="operational-overview-title">Operational overview</h2>
            </div>
            <p>Metrics become live with their owning modules.</p>
          </div>
          <div className="metric-grid">
            {Object.entries(dashboard.metrics).map(([key, metric]) => (
              <article className="metric-card" key={key}>
                <span>{metricLabels[key as keyof typeof metricLabels]}</span>
                <strong aria-label="Not yet available">—</strong>
                <small>Available in {metric.availableIn}</small>
              </article>
            ))}
          </div>
        </section>

        <div className="dashboard-lists">
          <section className="dashboard-list-card">
            <span className="section-label">RECENT ACTIVITY</span>
            <h2>Recent purchases</h2>
            <div className="dashboard-empty">
              Purchase activity will appear after Orders is released.
            </div>
          </section>
          <section className="dashboard-list-card">
            <span className="section-label">ATTENTION</span>
            <h2>Important notifications</h2>
            <div className="dashboard-empty">
              Account and operational alerts will appear after Notifications is released.
            </div>
          </section>
        </div>
      </main>
    </PharmacyShell>
  );
}
