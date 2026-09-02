CREATE TABLE "RecurringExecution" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "recurringTransactionId" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "entryType" VARCHAR(32),
  "entryId" TEXT,
  "mutationId" UUID,
  "resultJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecurringExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringExecution_status_check" CHECK ("status" IN ('PROCESSING', 'COMMITTED', 'FAILED')),
  CONSTRAINT "RecurringExecution_key_length_check" CHECK (char_length("idempotencyKey") BETWEEN 1 AND 255)
);

CREATE UNIQUE INDEX "RecurringExecution_occurrence_key"
  ON "RecurringExecution"("recurringTransactionId", "scheduledFor");
CREATE INDEX "RecurringExecution_familyId_scheduledFor_idx"
  ON "RecurringExecution"("familyId", "scheduledFor");

ALTER TABLE "RecurringExecution"
  ADD CONSTRAINT "RecurringExecution_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecurringExecution"
  ADD CONSTRAINT "RecurringExecution_recurringTransactionId_fkey"
  FOREIGN KEY ("recurringTransactionId") REFERENCES "RecurringTransaction"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
