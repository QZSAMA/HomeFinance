ALTER TABLE "Goal" ADD COLUMN "currency" TEXT;

UPDATE "Goal" AS goal
SET "currency" = COALESCE(family."baseCurrency", 'CNY')
FROM "Family" AS family
WHERE family."id" = goal."familyId"
  AND goal."currency" IS NULL;

ALTER TABLE "Goal"
  ALTER COLUMN "currency" SET DEFAULT 'CNY',
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "Goal"
  ADD CONSTRAINT "Goal_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE TABLE "GoalContribution" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "amount" DECIMAL(15,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "contributionDate" TIMESTAMP(3) NOT NULL,
  "allocationKey" VARCHAR(255) NOT NULL,
  "sourceKey" VARCHAR(255) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoalContribution"
  ADD CONSTRAINT "GoalContribution_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "GoalContribution_source_type_check" CHECK ("sourceType" IN ('INCOME', 'EXPENSE', 'ASSET', 'LIABILITY', 'MANUAL')),
  ADD CONSTRAINT "GoalContribution_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE UNIQUE INDEX "GoalContribution_allocation_key" ON "GoalContribution"("familyId", "allocationKey");
CREATE UNIQUE INDEX "GoalContribution_source_key" ON "GoalContribution"("familyId", "sourceKey");
CREATE INDEX "GoalContribution_family_goal_date_idx" ON "GoalContribution"("familyId", "goalId", "contributionDate");

ALTER TABLE "GoalContribution"
  ADD CONSTRAINT "GoalContribution_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GoalContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GoalContribution_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "GoalContribution_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "GoalContribution"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();
