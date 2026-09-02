ALTER TABLE "RecurringTransaction" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "RecurringTransaction_familyId_deletedAt_idx"
  ON "RecurringTransaction"("familyId", "deletedAt");
