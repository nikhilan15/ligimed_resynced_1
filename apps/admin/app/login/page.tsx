import { redirect } from 'next/navigation';

import { AdminLoginForm } from '../../components/admin-login-form';
import { readAdminSession } from '../../lib/api-server';

export default async function AdminLoginPage() {
  if (await readAdminSession()) redirect('/reviews');
  return (
    <main className="admin-login-page">
      <div className="admin-login-story">
        <span className="admin-brand">
          <b>✚</b> LigiMed <small>OPERATIONS</small>
        </span>
        <div>
          <span className="admin-label">COMPLIANCE WORKSPACE</span>
          <h1>
            Review carefully.
            <br />
            <em>Activate responsibly.</em>
          </h1>
          <p>Every pharmacy decision is scoped, reviewable and recorded for the supply chain.</p>
        </div>
      </div>
      <div className="admin-login-panel">
        <AdminLoginForm />
      </div>
    </main>
  );
}
