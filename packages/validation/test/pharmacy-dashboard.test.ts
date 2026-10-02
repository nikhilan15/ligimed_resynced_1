import { describe, expect, it } from 'vitest';

import { pharmacyDashboardSchema } from '../src/index.js';

const unavailable = { value: null, available: false, availableIn: 'PH1.9 Orders' };

describe('pharmacy dashboard response', () => {
  it('accepts the explicit unavailable-metric contract', () => {
    expect(
      pharmacyDashboardSchema.parse({
        user: { displayName: 'Pharmacy Owner' },
        pharmacy: {
          id: '31e6d8e6-17d9-4dba-a27f-a11441438b8e',
          name: 'Care Pharmacy',
          status: 'PENDING',
        },
        access: 'ONBOARDING',
        onboarding: { kycStatus: 'SUBMITTED', submittedAt: null, action: 'AWAIT_REVIEW' },
        metrics: {
          todaysOrders: unavailable,
          pendingOrders: unavailable,
          completedOrders: unavailable,
          inventoryValue: unavailable,
          lowStockProducts: unavailable,
          nearExpiryProducts: unavailable,
          outstandingPayments: unavailable,
        },
        recentPurchases: [],
        importantNotifications: [],
      }).metrics.todaysOrders.available,
    ).toBe(false);
  });

  it('rejects fabricated numeric values before their modules exist', () => {
    expect(() =>
      pharmacyDashboardSchema.parse({ metrics: { todaysOrders: { value: 0 } } }),
    ).toThrow();
  });
});
