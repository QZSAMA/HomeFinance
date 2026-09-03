ALTER TABLE "Budget" ADD COLUMN "currency" TEXT;

UPDATE "Budget" AS budget
SET "currency" = COALESCE(family."baseCurrency", 'CNY')
FROM "Family" AS family
WHERE family."id" = budget."familyId"
  AND budget."currency" IS NULL;

ALTER TABLE "Budget"
  ALTER COLUMN "currency" SET DEFAULT 'CNY',
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "Budget"
  ADD CONSTRAINT "Budget_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');


