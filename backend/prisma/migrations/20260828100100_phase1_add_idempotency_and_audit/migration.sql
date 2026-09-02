CREATE TABLE "IdempotencyRecord" (
  "id" UUID NOT NULL,
  "familyId" TEXT NOT NULL,
  "actorScope" VARCHAR(255) NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "key" VARCHAR(255) NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "httpStatus" INTEGER,
  "responseJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IdempotencyRecord_key_length_check" CHECK (char_length("key") BETWEEN 1 AND 255),
  CONSTRAINT "IdempotencyRecord_payloadHash_format_check" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "IdempotencyRecord_httpStatus_check" CHECK ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599),
  CONSTRAINT "IdempotencyRecord_completion_state_check" CHECK (
    ("httpStatus" IS NULL AND "responseJson" IS NULL)
    OR ("httpStatus" IS NOT NULL AND "responseJson" IS NOT NULL)
  )
);

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "familyId" TEXT NOT NULL,
  "mutationId" UUID NOT NULL,
  "actorUserId" TEXT,
  "actorSnapshot" JSONB NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "entity" VARCHAR(64) NOT NULL,
  "entityId" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyRecord_scope_key"
  ON "IdempotencyRecord"("familyId", "actorScope", "operation", "key");
CREATE INDEX "IdempotencyRecord_familyId_createdAt_idx"
  ON "IdempotencyRecord"("familyId", "createdAt");
CREATE INDEX "AuditEvent_familyId_createdAt_idx"
  ON "AuditEvent"("familyId", "createdAt");
CREATE INDEX "AuditEvent_mutationId_idx" ON "AuditEvent"("mutationId");
CREATE INDEX "AuditEvent_entity_entityId_idx" ON "AuditEvent"("entity", "entityId");

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_mutationId_fkey"
  FOREIGN KEY ("mutationId") REFERENCES "IdempotencyRecord"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
