import { createHash, randomUUID } from 'node:crypto';

import { AuthorizationError } from '@ligimed/auth';
import type { Prisma, PrismaClient } from '@ligimed/database';
import { organizationObjectKey, type PrivateObjectStorage } from '@ligimed/storage';
import type { RequestContext } from '@ligimed/types';
import type {
  DealerKycProfileInput,
  KycEvidenceMetadata,
  PharmacyKycProfileInput,
} from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';

const policyNotice =
  'Document categories are onboarding evidence options, not a statement of legal sufficiency. Required evidence and review rules need qualified compliance approval.';

const editableStatuses = new Set(['DRAFT']);

/** Organization-scoped KYC workflow shared by pharmacy and dealer onboarding. */
export class PartnerKycService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: PrivateObjectStorage,
    private readonly kind: 'PHARMACY' | 'DEALER' = 'PHARMACY',
  ) {}

  async getState(sessionId: string, context: RequestContext) {
    await this.assertAccess(sessionId, context);
    return this.readState(context.organizationId);
  }

  async saveProfile(
    sessionId: string,
    context: RequestContext,
    input: PharmacyKycProfileInput | DealerKycProfileInput,
  ) {
    await this.assertAccess(sessionId, context);
    await this.database.$transaction(async (transaction) => {
      await this.lockOrganization(transaction, context.organizationId);
      const existingProfile =
        this.kind === 'PHARMACY'
          ? await transaction.pharmacyProfile.findUnique({
              where: { organizationId: context.organizationId },
            })
          : await transaction.dealerProfile.findUnique({
              where: { organizationId: context.organizationId },
            });
      let primaryAddressId = existingProfile?.primaryAddressId ?? null;
      if (primaryAddressId) {
        const updated = await transaction.address.updateMany({
          where: { id: primaryAddressId, organizationId: context.organizationId },
          data: input.address,
        });
        if (updated.count !== 1) throw new AuthorizationError();
      } else {
        const address = await transaction.address.create({
          data: { organizationId: context.organizationId, ...input.address },
        });
        primaryAddressId = address.id;
      }
      const organization = await transaction.organization.updateMany({
        where: {
          id: context.organizationId,
          type: this.kind,
          status: { in: ['PENDING', 'ACTIVE'] },
        },
        data: { legalName: input.legalName, tradeName: input.tradeName },
      });
      if (organization.count !== 1) throw new AuthorizationError();
      const profileData = {
        primaryAddressId,
        operationalEmail: input.operationalEmail,
        websiteUrl: input.websiteUrl,
      };
      if (this.kind === 'PHARMACY') {
        await transaction.pharmacyProfile.upsert({
          where: { organizationId: context.organizationId },
          create: { organizationId: context.organizationId, ...profileData },
          update: profileData,
        });
      } else {
        const dealerInput = input as DealerKycProfileInput;
        await transaction.dealerProfile.upsert({
          where: { organizationId: context.organizationId },
          create: { organizationId: context.organizationId, ...profileData },
          update: profileData,
        });
        await transaction.dealerPublicProfile.upsert({
          where: { organizationId: context.organizationId },
          create: {
            organizationId: context.organizationId,
            summary: dealerInput.summary,
            city: input.address.city,
            state: input.address.state,
            serviceAreas: dealerInput.serviceAreas,
          },
          update: {
            summary: dealerInput.summary,
            city: input.address.city,
            state: input.address.state,
            serviceAreas: dealerInput.serviceAreas,
          },
        });
      }
      const record = await this.editableRecord(
        transaction,
        context,
        input.authorizedRepresentativeName,
        input.authorizedRepresentativeRole,
      );
      await transaction.kycRecord.update({
        where: { id: record.id },
        data: {
          authorizedRepresentativeName: input.authorizedRepresentativeName,
          authorizedRepresentativeRole: input.authorizedRepresentativeRole,
          updatedById: context.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: `${this.kind.toLowerCase()}.kyc_profile_saved`,
          resourceType: 'kyc_record',
          resourceId: record.id,
          outcome: 'SUCCESS',
          details: { revision: record.revision },
        },
      });
    });
    return this.readState(context.organizationId);
  }

  async addEvidence(
    sessionId: string,
    context: RequestContext,
    metadata: KycEvidenceMetadata,
    file: { filename: string; contentType: string; contents: Uint8Array },
  ) {
    await this.assertAccess(sessionId, context);
    const id = randomUUID();
    const objectKey = organizationObjectKey(context.organizationId, id);
    const checksumSha256 = createHash('sha256').update(file.contents).digest('hex');
    await this.storage.put(
      {
        organizationId: context.organizationId,
        objectKey,
        contentType: file.contentType,
        contentLength: file.contents.byteLength,
        checksumSha256,
      },
      file.contents,
    );
    try {
      await this.database.$transaction(async (transaction) => {
        await this.lockOrganization(transaction, context.organizationId);
        const record = await transaction.kycRecord.findFirst({
          where: { organizationId: context.organizationId },
          orderBy: { revision: 'desc' },
        });
        if (!record) {
          throw new AppError(409, 'KYC_PROFILE_REQUIRED', 'Save the organization profile first.');
        }
        if (!editableStatuses.has(record.status)) throw this.lockedError();
        await transaction.kycEvidence.create({
          data: {
            id,
            organizationId: context.organizationId,
            kycRecordId: record.id,
            category: metadata.category,
            referenceNumber: metadata.referenceNumber,
            expiresAt: metadata.expiresAt ? new Date(`${metadata.expiresAt}T00:00:00.000Z`) : null,
            objectKey,
            originalFilename: file.filename,
            contentType: file.contentType,
            contentLength: file.contents.byteLength,
            checksumSha256,
            uploadedById: context.userId,
          },
        });
        await transaction.auditLog.create({
          data: {
            requestId: context.requestId,
            actorUserId: context.userId,
            organizationId: context.organizationId,
            action: `${this.kind.toLowerCase()}.kyc_evidence_uploaded`,
            resourceType: 'kyc_evidence',
            resourceId: id,
            outcome: 'SUCCESS',
            details: { category: metadata.category, contentType: file.contentType },
          },
        });
      });
    } catch (error) {
      await this.storage.delete(objectKey);
      throw error;
    }
    return this.readState(context.organizationId);
  }

  async removeEvidence(sessionId: string, context: RequestContext, evidenceId: string) {
    await this.assertAccess(sessionId, context);
    const result = await this.database.$transaction(async (transaction) => {
      await this.lockOrganization(transaction, context.organizationId);
      const evidence = await transaction.kycEvidence.findFirst({
        where: { id: evidenceId, organizationId: context.organizationId },
        include: { kycRecord: { select: { status: true } } },
      });
      if (!evidence) throw new AppError(404, 'KYC_EVIDENCE_NOT_FOUND', 'Evidence was not found.');
      if (!editableStatuses.has(evidence.kycRecord.status)) throw this.lockedError();
      await transaction.kycEvidence.delete({ where: { id: evidence.id } });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: `${this.kind.toLowerCase()}.kyc_evidence_removed`,
          resourceType: 'kyc_evidence',
          resourceId: evidence.id,
          outcome: 'SUCCESS',
        },
      });
      return evidence.objectKey;
    });
    await this.storage.delete(result);
    return this.readState(context.organizationId);
  }

  async evidenceContent(sessionId: string, context: RequestContext, evidenceId: string) {
    await this.assertAccess(sessionId, context);
    const evidence = await this.database.kycEvidence.findFirst({
      where: { id: evidenceId, organizationId: context.organizationId },
      select: { objectKey: true, originalFilename: true, contentType: true, checksumSha256: true },
    });
    if (!evidence) throw new AppError(404, 'KYC_EVIDENCE_NOT_FOUND', 'Evidence was not found.');
    const contents = await this.storage.read(evidence.objectKey);
    if (!contents) throw new AppError(404, 'KYC_EVIDENCE_NOT_FOUND', 'Evidence was not found.');
    if (createHash('sha256').update(contents).digest('hex') !== evidence.checksumSha256) {
      throw new AppError(503, 'KYC_EVIDENCE_UNAVAILABLE', 'Evidence is temporarily unavailable.');
    }
    return { ...evidence, contents };
  }

  async submit(sessionId: string, context: RequestContext) {
    await this.assertAccess(sessionId, context);
    await this.database.$transaction(async (transaction) => {
      await this.lockOrganization(transaction, context.organizationId);
      const record = await transaction.kycRecord.findFirst({
        where: { organizationId: context.organizationId },
        orderBy: { revision: 'desc' },
        include: { _count: { select: { evidence: true } } },
      });
      if (!record)
        throw new AppError(409, 'KYC_PROFILE_REQUIRED', 'Save the organization profile first.');
      if (!editableStatuses.has(record.status)) throw this.lockedError();
      const profile =
        this.kind === 'PHARMACY'
          ? await transaction.pharmacyProfile.findUnique({
              where: { organizationId: context.organizationId },
            })
          : await transaction.dealerProfile.findUnique({
              where: { organizationId: context.organizationId },
            });
      if (!profile?.primaryAddressId) {
        throw new AppError(
          409,
          'KYC_PROFILE_INCOMPLETE',
          'Complete the organization profile first.',
        );
      }
      if (record._count.evidence < 1) {
        throw new AppError(
          409,
          'KYC_EVIDENCE_REQUIRED',
          'Upload at least one supporting document before submitting.',
        );
      }
      const now = new Date();
      await transaction.kycRecord.update({
        where: { id: record.id },
        data: {
          status: 'SUBMITTED',
          declarationAcceptedAt: now,
          submittedAt: now,
          updatedById: context.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: `${this.kind.toLowerCase()}.kyc_submitted`,
          resourceType: 'kyc_record',
          resourceId: record.id,
          outcome: 'SUCCESS',
          details: { revision: record.revision, evidenceCount: record._count.evidence },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: 'kyc_record',
          aggregateId: record.id,
          eventType: `${this.kind.toLowerCase()}.kyc.submitted`,
          payload: { organizationId: context.organizationId, revision: record.revision },
        },
      });
    });
    return this.readState(context.organizationId);
  }

  private async assertAccess(sessionId: string, context: RequestContext) {
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
          roles: {
            some: {
              role: {
                organizationType: this.kind,
                OR: [
                  { key: `${this.kind}_ADMIN` },
                  { permissions: { some: { permission: { key: 'kyc.submit' } } } },
                ],
              },
            },
          },
        },
        activeOrganization: { type: this.kind, status: { in: ['PENDING', 'ACTIVE'] } },
      },
      select: { id: true },
    });
    if (!session) throw new AuthorizationError();
  }

  private async lockOrganization(transaction: Prisma.TransactionClient, organizationId: string) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations
      WHERE id = ${organizationId}::uuid AND type = ${this.kind}::"OrganizationType"
        AND status IN ('PENDING', 'ACTIVE')
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new AuthorizationError();
  }

  private async editableRecord(
    transaction: Prisma.TransactionClient,
    context: RequestContext,
    representativeName: string,
    representativeRole: string | null,
  ) {
    const latest = await transaction.kycRecord.findFirst({
      where: { organizationId: context.organizationId },
      orderBy: { revision: 'desc' },
    });
    if (!latest) {
      return transaction.kycRecord.create({
        data: {
          organizationId: context.organizationId,
          revision: 1,
          authorizedRepresentativeName: representativeName,
          authorizedRepresentativeRole: representativeRole,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
    }
    if (latest.status === 'REJECTED' || latest.status === 'EXPIRED') {
      return transaction.kycRecord.create({
        data: {
          organizationId: context.organizationId,
          revision: latest.revision + 1,
          authorizedRepresentativeName: latest.authorizedRepresentativeName,
          authorizedRepresentativeRole: latest.authorizedRepresentativeRole,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
    }
    if (!editableStatuses.has(latest.status)) throw this.lockedError();
    return latest;
  }

  private lockedError() {
    return new AppError(409, 'KYC_SUBMISSION_LOCKED', 'This KYC submission is no longer editable.');
  }

  private async readState(organizationId: string) {
    const organization = await this.database.organization.findFirstOrThrow({
      where: { id: organizationId, type: this.kind },
      include: {
        pharmacyProfile: { include: { primaryAddress: true } },
        dealerProfile: { include: { primaryAddress: true } },
        dealerPublicProfile: true,
      },
    });
    const record = await this.database.kycRecord.findFirst({
      where: { organizationId },
      orderBy: { revision: 'desc' },
      include: { evidence: { orderBy: { createdAt: 'asc' } } },
    });
    const profile =
      this.kind === 'PHARMACY' ? organization.pharmacyProfile : organization.dealerProfile;
    return {
      [this.kind === 'PHARMACY' ? 'pharmacy' : 'dealer']: {
        legalName: organization.legalName,
        tradeName: organization.tradeName,
        operationalEmail: profile?.operationalEmail ?? null,
        websiteUrl: profile?.websiteUrl ?? null,
        ...(this.kind === 'DEALER'
          ? {
              summary: organization.dealerPublicProfile?.summary ?? null,
              serviceAreas: organization.dealerPublicProfile?.serviceAreas ?? [],
            }
          : {}),
        address: profile?.primaryAddress
          ? {
              name: profile.primaryAddress.name,
              line1: profile.primaryAddress.line1,
              line2: profile.primaryAddress.line2,
              city: profile.primaryAddress.city,
              district: profile.primaryAddress.district,
              state: profile.primaryAddress.state,
              stateCode: profile.primaryAddress.stateCode,
              postalCode: profile.primaryAddress.postalCode,
              country: 'IN' as const,
            }
          : null,
      },
      kyc: {
        id: record?.id ?? null,
        revision: record?.revision ?? null,
        status: record?.status ?? ('DRAFT' as const),
        authorizedRepresentativeName: record?.authorizedRepresentativeName ?? '',
        authorizedRepresentativeRole: record?.authorizedRepresentativeRole ?? null,
        submittedAt: record?.submittedAt?.toISOString() ?? null,
        rejectionReason: record?.rejectionReason ?? null,
        editable:
          !record || record.status === 'DRAFT' || ['REJECTED', 'EXPIRED'].includes(record.status),
        evidence:
          record?.evidence.map((item) => ({
            id: item.id,
            category: item.category,
            referenceNumber: item.referenceNumber,
            expiresAt: item.expiresAt?.toISOString().slice(0, 10) ?? null,
            originalFilename: item.originalFilename,
            contentType: item.contentType,
            contentLength: item.contentLength,
            status: item.status,
            rejectionReason: item.rejectionReason,
            uploadedAt: item.createdAt.toISOString(),
          })) ?? [],
      },
      policyNotice,
    };
  }
}
