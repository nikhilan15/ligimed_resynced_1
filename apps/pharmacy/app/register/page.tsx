import { redirect } from 'next/navigation';
import { AuthForm } from '../../components/auth-form';
import { AuthLayout } from '../../components/auth-layout';
import { readPharmacySession } from '../../lib/api-server';

export default async function RegisterPage() {
  if (await readPharmacySession()) redirect('/account');
  return (
    <AuthLayout>
      <AuthForm mode="register" />
    </AuthLayout>
  );
}
