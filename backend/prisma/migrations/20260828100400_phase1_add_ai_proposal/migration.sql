CREATE TABLE "AIProposal" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorSnapshot" JSONB NOT NULL,
  "sourceType" VARCHAR(32) NOT NULL,
  "sourceConversationId" TEXT,
  "sourceFileId" TEXT,
  "originalPayload" JSONB NOT NULL,
  "originalHash" CHAR(64) NOT NULL,
  "confirmedPayload" JSONB,
  "confirmedHash" CHAR(64),
  "status" VARCHAR(32) NOT NULL DEFAULT 'PROPOSED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resultJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AIProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIProposal_originalHash_format_check" CHECK (
    "originalHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "AIProposal_confirmedHash_format_check" CHECK (
    "confirmedHash" IS NULL OR "confirmedHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "AIProposal_confirmed_payload_pair_check" CHECK (
    ("confirmedPayload" IS NULL AND "confirmedHash" IS NULL)
    OR ("confirmedPayload" IS NOT NULL AND "confirmedHash" IS NOT NULL)
  ),
  CONSTRAINT "AIProposal_version_check" CHECK ("version" > 0),
  CONSTRAINT "AIProposal_source_type_check" CHECK (
    "sourceType" IN ('TEXT', 'OCR')
  ),
  CONSTRAINT "AIProposal_status_check" CHECK (
    "status" IN ('PROPOSED', 'CONFIRMING', 'EXECUTED', 'REJECTED', 'EXPIRED', 'FAILED')
  )
);

CREATE TABLE "AIProposalItem" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "typedAction" VARCHAR(64) NOT NULL,
  "canonicalData" JSONB NOT NULL,
  "resultJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AIProposalItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIProposalItem_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE UNIQUE INDEX "AIProposalItem_proposalId_ordinal_key"
  ON "AIProposalItem"("proposalId", "ordinal");
CREATE INDEX "AIProposal_familyId_createdAt_idx"
  ON "AIProposal"("familyId", "createdAt");
CREATE INDEX "AIProposal_familyId_status_expiresAt_idx"
  ON "AIProposal"("familyId", "status", "expiresAt");
CREATE INDEX "AIProposal_actorUserId_idx"
  ON "AIProposal"("actorUserId");
CREATE INDEX "AIProposal_sourceConversationId_idx"
  ON "AIProposal"("sourceConversationId");
CREATE INDEX "AIProposal_sourceFileId_idx"
  ON "AIProposal"("sourceFileId");
CREATE INDEX "AIProposalItem_proposalId_typedAction_idx"
  ON "AIProposalItem"("proposalId", "typedAction");

ALTER TABLE "AIProposal"
  ADD CONSTRAINT "AIProposal_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AIProposal_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AIProposal_sourceConversationId_fkey"
  FOREIGN KEY ("sourceConversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AIProposal_sourceFileId_fkey"
  FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AIProposalItem"
  ADD CONSTRAINT "AIProposalItem_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "AIProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
