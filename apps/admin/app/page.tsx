import { redirect } from 'next/navigation';

import { readAdminSession } from '../lib/api-server';

export default async function AdminHome() {
  redirect((await readAdminSession()) ? '/reviews' : '/login');
}
