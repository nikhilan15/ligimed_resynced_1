import { createHash } from 'node:crypto';

import { AuthorizationError, PERMISSIONS, requirePermission } from '@ligimed/auth';
import type { Prisma, PrismaClient } from '@ligimed/database';
import type { PrivateObjectStorage } from '@ligimed/storage';
import type { RequestContext } from '@ligimed/types';
import type { AdminKycDecision } from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';

export class AdminKycReviewService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async queue(
    sessionId: string,
    context: RequestContext,
    query: { cursor?: string | undefined; limit: number },
  ) {
    await this.assertReviewer(sessionId, context);
    const records = await this.database.kycRecord.findMany({
      where: {
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        organization: { type: { in: ['PHARMACY', 'DEALER'] }, status: 'PENDING' },
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: {
        organization: { select: { id: true, legalName: true, tradeName: true, type: true } },
        _count: { select: { evidence: true } },
      },
    });
    const hasMore = records.length > query.limit;
    const pageRecords = records.slice(0, query.limit);
    return {
      records: pageRecords.map((record) => ({
        id: record.id,
        revision: record.revision,
        status: record.status as 'SUBMITTED' | 'UNDER_REVIEW',
        submittedAt: record.submittedAt!.toISOString(),
        organization: {
          id: record.organization.id,
          name: record.organization.tradeName ?? record.organization.legalName,
          type: record.organization.type as 'PHARMACY' | 'DEALER',
        },
        representativeName: record.authorizedRepresentativeName,
        evidenceCount: record._count.evidence,
      })),
      page: {
        nextCursor: hasMore ? (pageRecords.at(-1)?.id ?? null) : null,
        hasMore,
      },
    };
  }

  async detail(sessionId: string, context: RequestContext, kycRecordId: string) {
    await this.assertReviewer(sessionId, context);
    const record = await this.database.kycRecord.findFirst({
      where: {
        id: kycRecordId,
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        organization: { type: { in: ['PHARMACY', 'DEALER'] }, status: 'PENDING' },
      },
      include: {
        organization: {
          include: {
            pharmacyProfile: { include: { primaryAddress: true } },
            dealerProfile: { include: { primaryAddress: true } },
            dealerPublicProfile: true,
          },
        },
        evidence: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!record) throw new AppError(404, 'KYC_RECORD_NOT_FOUND', 'KYC record was not found.');
    const profile =
      record.organization.type === 'PHARMACY'
        ? record.organization.pharmacyProfile
        : record.organization.dealerProfile;
    const address = profile?.primaryAddress;
    return {
      id: record.id,
      revision: record.revision,
      status: record.status as 'SUBMITTED' | 'UNDER_REVIEW',
      submittedAt: record.submittedAt!.toISOString(),
      organization: {
        id: record.organization.id,
        name: record.organization.tradeName ?? record.organization.legalName,
        type: record.organization.type as 'PHARMACY' | 'DEALER',
      },
      representativeName: record.authorizedRepresentativeName,
      representativeRole: record.authorizedRepresentativeRole,
      rejectionReason: record.rejectionReason,
      evidenceCount: record.evidence.length,
      profile: {
        legalName: record.organization.legalName,
        tradeName: record.organization.tradeName,
        operationalEmail: profile?.operationalEmail ?? null,
        websiteUrl: profile?.websiteUrl ?? null,
        summary: record.organization.dealerPublicProfile?.summary ?? null,
        serviceAreas: record.organization.dealerPublicProfile?.serviceAreas ?? [],
        address: address
          ? {
              name: address.name,
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              district: address.district,
              state: address.state,
              stateCode: address.stateCode,
              postalCode: address.postalCode,
              country: address.country,
            }
          : null,
      },
      evidence: record.evidence.map((evidence) => ({
        id: evidence.id,
        category: evidence.category,
        referenceNumber: evidence.referenceNumber,
        expiresAt: evidence.expiresAt?.toISOString().slice(0, 10) ?? null,
        originalFilename: evidence.originalFilename,
        contentType: evidence.contentType,
        status: evidence.status,
      })),
    };
  }

  async evidenceContent(
    sessionId: string,
    context: RequestContext,
    kycRecordId: string,
    evidenceId: string,
  ) {
    await this.assertReviewer(sessionId, context);
    const evidence = await this.database.kycEvidence.findFirst({
      where: {
        id: evidenceId,
        kycRecordId,
        kycRecord: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
        organization: { type: { in: ['PHARMACY', 'DEALER'] }, status: 'PENDING' },
      },
      select: {
        objectKey: true,
        originalFilename: true,
        contentType: true,
        checksumSha256: true,
      },
    });
    if (!evidence) throw new AppError(404, 'KYC_EVIDENCE_NOT_FOUND', 'Evidence was not found.');
    const contents = await this.storage.read(evidence.objectKey);
    if (!contents) throw new AppError(404, 'KYC_EVIDENCE_NOT_FOUND', 'Evidence was not found.');
    if (createHash('sha256').update(contents).digest('hex') !== evidence.checksumSha256) {
      throw new AppError(503, 'KYC_EVIDENCE_UNAVAILABLE', 'Evidence is temporarily unavailable.');
    }
    return { ...evidence, contents };
  }

  async startReview(sessionId: string, context: RequestContext, kycRecordId: string) {
    await this.assertReviewer(sessionId, context);
    await this.database.$transaction(async (transaction) => {
      const record = await this.lockReviewableRecord(transaction, kycRecordId);
      if (record.status === 'SUBMITTED') {
        await transaction.kycRecord.update({
          where: { id: record.id },
          data: { status: 'UNDER_REVIEW', updatedById: context.userId },
        });
        await transaction.auditLog.create({
          data: {
            requestId: context.requestId,
            actorUserId: context.userId,
            organizationId: record.organizationId,
            action: 'admin.kyc_review_started',
            resourceType: 'kyc_record',
            resourceId: record.id,
            outcome: 'SUCCESS',
          },
        });
      }
    });
    return this.detail(sessionId, context, kycRecordId);
  }

  async decide(
    sessionId: string,
    context: RequestContext,
    kycRecordId: string,
    decision: AdminKycDecision,
  ) {
    await this.assertReviewer(sessionId, context);
    return this.database.$transaction(async (transaction) => {
      const record = await this.lockReviewableRecord(transaction, kycRecordId);
      const now = new Date();
      if (decision.decision === 'APPROVE') {
        await transaction.kycRecord.update({
          where: { id: record.id },
          data: {
            status: 'VERIFIED',
            rejectionReason: null,
            reviewedAt: now,
            reviewedById: context.userId,
            updatedById: context.userId,
          },
        });
        await transaction.kycEvidence.updateMany({
          where: { kycRecordId: record.id },
          data: { status: 'VERIFIED', rejectionReason: null },
        });
        const activation = await transaction.organization.updateMany({
          where: { id: record.organizationId, type: record.organizationType, status: 'PENDING' },
          data: { status: 'ACTIVE' },
        });
        if (activation.count !== 1) throw new AuthorizationError();
        await transaction.session.updateMany({
          where: {
            activeOrganizationId: record.organizationId,
            scope: 'ONBOARDING',
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      } else {
        await transaction.kycRecord.update({
          where: { id: record.id },
          data: {
            status: 'REJECTED',
            rejectionReason: decision.reason,
            reviewedAt: now,
            reviewedById: context.userId,
            updatedById: context.userId,
          },
        });
        await transaction.kycEvidence.updateMany({
          where: { kycRecordId: record.id },
          data: { status: 'REJECTED', rejectionReason: decision.reason },
        });
      }
      const approved = decision.decision === 'APPROVE';
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: record.organizationId,
          action: approved ? 'admin.kyc_approved' : 'admin.kyc_rejected',
          resourceType: 'kyc_record',
          resourceId: record.id,
          outcome: 'SUCCESS',
          details: approved
            ? { revision: record.revision }
            : { revision: record.revision, reason: decision.reason },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: 'kyc_record',
          aggregateId: record.id,
          eventType: approved
            ? `${record.organizationType.toLowerCase()}.kyc.verified`
            : `${record.organizationType.toLowerCase()}.kyc.rejected`,
          payload: {
            organizationId: record.organizationId,
            revision: record.revision,
            ...(approved ? {} : { reason: decision.reason }),
          },
        },
      });
      return {
        kycStatus: approved ? ('VERIFIED' as const) : ('REJECTED' as const),
        organizationStatus: approved ? ('ACTIVE' as const) : ('PENDING' as const),
      };
    });
  }

  private async assertReviewer(sessionId: string, context: RequestContext) {
    requirePermission(context, PERMISSIONS.KYC_REVIEW);
    const session = await this.database.session.findFirst({
      where: {
        id: sessionId,
        scope: 'FULL',
        userId: context.userId,
        membershipId: context.membershipId,
        activeOrganizationId: context.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
        membership: { status: 'ACTIVE', organizationId: context.organizationId },
        activeOrganization: { type: 'LIGIMED_INTERNAL', status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!session) throw new AuthorizationError();
  }

  private async lockReviewableRecord(transaction: Prisma.TransactionClient, id: string) {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        organizationType: 'PHARMACY' | 'DEALER';
        revision: number;
        status: 'SUBMITTED' | 'UNDER_REVIEW';
      }>
    >`
      SELECT k.id, k."organizationId", o.type::text AS "organizationType", k.revision, k.status::text
      FROM kyc_records k
      INNER JOIN organizations o ON o.id = k."organizationId"
      WHERE k.id = ${id}::uuid
        AND k.status IN ('SUBMITTED', 'UNDER_REVIEW')
        AND o.type IN ('PHARMACY', 'DEALER')
        AND o.status = 'PENDING'
        AND k.revision = (
          SELECT MAX(latest.revision)
          FROM kyc_records latest
          WHERE latest."organizationId" = k."organizationId"
        )
      FOR UPDATE OF k, o
    `;
    const record = rows[0];
    if (!record) throw new AppError(409, 'KYC_NOT_REVIEWABLE', 'KYC record is not reviewable.');
    return record;
  }
}
