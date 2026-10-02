ALTER TABLE documents ADD COLUMN designation varchar(100);
ALTER TABLE document_reminders ALTER COLUMN "documentId" DROP NOT NULL;
ALTER TABLE document_reminders ADD COLUMN "kycEvidenceId" uuid REFERENCES kyc_evidence(id) ON DELETE CASCADE;
ALTER TABLE document_reminders ADD CONSTRAINT document_reminder_single_source CHECK (("documentId" IS NOT NULL)::int + ("kycEvidenceId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "document_reminders_kycEvidenceId_thresholdDays_key" ON document_reminders("kycEvidenceId", "thresholdDays");
