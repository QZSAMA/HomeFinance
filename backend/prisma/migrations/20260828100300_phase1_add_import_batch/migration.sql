CREATE TABLE "ImportBatch" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "fileHash" CHAR(64) NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "previewHash" CHAR(64) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportBatch_fileHash_format_check" CHECK ("fileHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ImportBatch_previewHash_format_check" CHECK ("previewHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ImportBatch_rowCount_check" CHECK ("rowCount" >= 0),
  CONSTRAINT "ImportBatch_status_check" CHECK (
    "status" IN ('PREVIEWED', 'CONFIRMING', 'COMMITTED', 'FAILED', 'EXPIRED')
  )
);

CREATE TABLE "ImportRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "canonicalPayload" JSONB NOT NULL,
  "validationErrors" JSONB,
  "status" TEXT NOT NULL DEFAULT 'VALID',
  "resultEntityType" TEXT,
  "resultEntityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportRow_rowNumber_check" CHECK ("rowNumber" > 0),
  CONSTRAINT "ImportRow_status_check" CHECK (
    "status" IN ('VALID', 'INVALID', 'COMMITTED', 'FAILED')
  ),
  CONSTRAINT "ImportRow_result_reference_check" CHECK (
    ("resultEntityType" IS NULL AND "resultEntityId" IS NULL)
    OR ("resultEntityType" IS NOT NULL AND "resultEntityId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ImportRow_batchId_rowNumber_key"
  ON "ImportRow"("batchId", "rowNumber");
CREATE INDEX "ImportBatch_familyId_createdAt_idx"
  ON "ImportBatch"("familyId", "createdAt");
CREATE INDEX "ImportBatch_familyId_status_idx"
  ON "ImportBatch"("familyId", "status");
CREATE INDEX "ImportBatch_familyId_previewHash_idx"
  ON "ImportBatch"("familyId", "previewHash");
CREATE INDEX "ImportBatch_actorUserId_idx"
  ON "ImportBatch"("actorUserId");
CREATE INDEX "ImportRow_batchId_status_idx"
  ON "ImportRow"("batchId", "status");

ALTER TABLE "ImportBatch"
  ADD CONSTRAINT "ImportBatch_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ImportBatch_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportRow"
  ADD CONSTRAINT "ImportRow_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
