import { expect, test } from '@playwright/test';

const host = process.env['E2E_HOST'] ?? '127.0.0.1';
const applications = [
  { name: 'Pharmacy sign-in', url: `http://${host}:3000/login`, heading: 'Welcome back.' },
  { name: 'Dealer workspace', url: `http://${host}:3001` },
  { name: 'Transport workspace', url: `http://${host}:3002` },
  { name: 'Administration workspace', url: `http://${host}:3003` },
] as const;

for (const application of applications) {
  test(`${application.name} shell renders`, async ({ page }) => {
    await page.goto(application.url);
    await expect(
      page.getByRole('heading', {
        name: 'heading' in application ? application.heading : application.name,
      }),
    ).toBeVisible();
    if (!('heading' in application))
      await expect(page.getByText('Phase 0 foundation', { exact: true })).toBeVisible();
  });
}
