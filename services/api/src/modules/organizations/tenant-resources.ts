import {
  PERMISSIONS,
  requireOrganizationScope,
  requirePermission,
  type Permission,
} from '@ligimed/auth';
import type { PrismaClient, SessionRepository } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import { idSchema } from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';

export interface TenantResourceRequest {
  /** Opaque credential, never a caller-constructed RequestContext. */
  token: string | undefined;
  requestId: string;
  resourceId: string;
  /** Optional path/query claim. The database-backed session remains authoritative. */
  organizationId?: string;
}

/**
 * Foundation read service. Future tenant-owned repositories must follow the same pattern:
 * resolve the credential, check permission, and include the resolved tenant in the SQL query.
 * Do not fetch by resource id first and rely on frontend filtering or an administrator bypass.
 */
export class TenantResourceService {
  constructor(
    private readonly database: PrismaClient,
    private readonly sessions: SessionRepository,
  ) {}

  private async withinTenant<T>(
    request: TenantResourceRequest,
    permission: Permission,
    find: (
      scope: { organizationId: string; resourceId: string },
      context: RequestContext,
    ) => Promise<T | null>,
  ): Promise<T> {
    if (typeof request.token !== 'string' || request.token.length === 0) {
      throw new AppError(
        401,
        'AUTHENTICATION_REQUIRED',
        'An active session is required',
        'authentication',
      );
    }

    const session = await this.sessions.resolve(request.token, request.requestId);
    if (!session) {
      throw new AppError(
        401,
        'AUTHENTICATION_REQUIRED',
        'An active session is required',
        'authentication',
      );
    }

    requirePermission(session.context, permission);
    if (request.organizationId !== undefined) {
      requireOrganizationScope(session.context, {
        organizationId: idSchema.parse(request.organizationId),
      });
    }

    const resource = await find(
      {
        organizationId: session.context.organizationId,
        resourceId: idSchema.parse(request.resourceId),
      },
      session.context,
    );
    if (resource === null) {
      // A missing record and another tenant's record have the same public response.
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Resource not found', 'not-found');
    }
    return resource;
  }

  getUser(request: TenantResourceRequest) {
    return this.withinTenant(request, PERMISSIONS.ORGANIZATION_READ, (scope) =>
      this.database.user.findFirst({
        where: {
          id: scope.resourceId,
          memberships: { some: { organizationId: scope.organizationId, status: 'ACTIVE' } },
        },
        // Users are global identities. Only a minimal profile shared by a current member is exposed.
        select: { id: true, displayName: true, isActive: true },
      }),
    );
  }

  getMembership(request: TenantResourceRequest) {
    return this.withinTenant(request, PERMISSIONS.ORGANIZATION_READ, (scope) =>
      this.database.membership.findFirst({
        where: { id: scope.resourceId, organizationId: scope.organizationId },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          status: true,
          joinedAt: true,
          createdAt: true,
        },
      }),
    );
  }

  getAddress(request: TenantResourceRequest) {
    return this.withinTenant(request, PERMISSIONS.ORGANIZATION_READ, (scope) =>
      this.database.address.findFirst({
        where: { id: scope.resourceId, organizationId: scope.organizationId },
        select: {
          id: true,
          organizationId: true,
          name: true,
          line1: true,
          line2: true,
          city: true,
          district: true,
          state: true,
          stateCode: true,
          postalCode: true,
          country: true,
        },
      }),
    );
  }

  getSession(request: TenantResourceRequest) {
    return this.withinTenant(request, PERMISSIONS.ORGANIZATION_READ, (scope, context) =>
      this.database.session.findFirst({
        where: {
          id: scope.resourceId,
          activeOrganizationId: scope.organizationId,
          membershipId: context.membershipId,
          userId: context.userId,
        },
        select: {
          id: true,
          activeOrganizationId: true,
          assuranceLevel: true,
          createdAt: true,
          expiresAt: true,
          lastSeenAt: true,
          revokedAt: true,
        },
      }),
    );
  }

  getAuditLog(request: TenantResourceRequest) {
    return this.withinTenant(request, PERMISSIONS.AUDIT_READ, (scope) =>
      this.database.auditLog.findFirst({
        where: { id: scope.resourceId, organizationId: scope.organizationId },
        // Arbitrary details and network identifiers require a separate redaction policy.
        select: {
          id: true,
          organizationId: true,
          occurredAt: true,
          requestId: true,
          actorUserId: true,
          action: true,
          resourceType: true,
          resourceId: true,
          outcome: true,
        },
      }),
    );
  }
}
