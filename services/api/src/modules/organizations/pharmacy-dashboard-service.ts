import { AuthorizationError, PERMISSIONS, requirePermission } from '@ligimed/auth';
import type { PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';

const unavailable = (availableIn: string) => ({
  value: null,
  available: false as const,
  availableIn,
});

export class PharmacyDashboardService {
  constructor(private readonly database: PrismaClient) {}

  async getDashboard(sessionId: string, context: RequestContext) {
    const session = await this.database.session.findFirst({
      where: {
        id: sessionId,
        userId: context.userId,
        membershipId: context.membershipId,
        activeOrganizationId: context.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
        membership: {
          status: 'ACTIVE',
          organizationId: context.organizationId,
          roles: { some: { role: { organizationType: 'PHARMACY' } } },
        },
        activeOrganization: { type: 'PHARMACY', status: { in: ['PENDING', 'ACTIVE'] } },
      },
      select: {
        scope: true,
        user: { select: { displayName: true } },
        activeOrganization: {
          select: {
            id: true,
            status: true,
            legalName: true,
            tradeName: true,
            kycRecords: {
              take: 1,
              orderBy: { revision: 'desc' },
              select: { status: true, submittedAt: true },
            },
          },
        },
      },
    });
    if (!session) throw new AuthorizationError();

    const fullAccess = session.scope === 'FULL' && session.activeOrganization.status === 'ACTIVE';
    if (fullAccess) requirePermission(context, PERMISSIONS.ORGANIZATION_READ);
    const kyc = session.activeOrganization.kycRecords[0] ?? null;

    return {
      user: session.user,
      pharmacy: {
        id: session.activeOrganization.id,
        name: session.activeOrganization.tradeName ?? session.activeOrganization.legalName,
        status: session.activeOrganization.status,
      },
      access: fullAccess ? ('FULL' as const) : ('ONBOARDING' as const),
      onboarding: {
        kycStatus: kyc?.status ?? null,
        submittedAt: kyc?.submittedAt?.toISOString() ?? null,
        action: this.onboardingAction(fullAccess, kyc?.status ?? null),
      },
      metrics: {
        todaysOrders: unavailable('PH1.9 Orders'),
        pendingOrders: unavailable('PH1.9 Orders'),
        completedOrders: unavailable('PH1.9 Orders'),
        inventoryValue: unavailable('PH1.10 Inventory'),
        lowStockProducts: unavailable('PH1.10 Inventory'),
        nearExpiryProducts: unavailable('PH1.10 Inventory'),
        outstandingPayments: unavailable('PH1.11 Billing'),
      },
      recentPurchases: [],
      importantNotifications: [],
    };
  }

  private onboardingAction(
    fullAccess: boolean,
    status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | null,
  ) {
    if (fullAccess) return 'NONE' as const;
    if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') return 'AWAIT_REVIEW' as const;
    if (status === 'VERIFIED') return 'AWAIT_ACTIVATION' as const;
    if (status === 'REJECTED' || status === 'EXPIRED') return 'RESOLVE_REJECTION' as const;
    return 'COMPLETE_KYC' as const;
  }
}
