-- Phase 1 expand: add nullable columns first so the previous application can keep writing.
ALTER TABLE "Family" ADD COLUMN "baseCurrency" TEXT;

ALTER TABLE "Income"
  ADD COLUMN "version" INTEGER,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "originType" TEXT,
  ADD COLUMN "originRef" TEXT;

ALTER TABLE "Expense"
  ADD COLUMN "version" INTEGER,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "originType" TEXT,
  ADD COLUMN "originRef" TEXT;

ALTER TABLE "RecurringTransaction" ADD COLUMN "version" INTEGER;

-- Backfill historical facts before enforcing the non-null application contract.
UPDATE "Family" SET "baseCurrency" = 'CNY' WHERE "baseCurrency" IS NULL;
UPDATE "Income" SET "version" = 1 WHERE "version" IS NULL;
UPDATE "Income" SET "currency" = 'CNY' WHERE "currency" IS NULL;
UPDATE "Expense" SET "version" = 1 WHERE "version" IS NULL;
UPDATE "Expense" SET "currency" = 'CNY' WHERE "currency" IS NULL;
UPDATE "RecurringTransaction" SET "version" = 1 WHERE "version" IS NULL;

ALTER TABLE "Family"
  ALTER COLUMN "baseCurrency" SET DEFAULT 'CNY',
  ALTER COLUMN "baseCurrency" SET NOT NULL;

ALTER TABLE "Income"
  ALTER COLUMN "version" SET DEFAULT 1,
  ALTER COLUMN "version" SET NOT NULL,
  ALTER COLUMN "currency" SET DEFAULT 'CNY',
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "Expense"
  ALTER COLUMN "version" SET DEFAULT 1,
  ALTER COLUMN "version" SET NOT NULL,
  ALTER COLUMN "currency" SET DEFAULT 'CNY',
  ALTER COLUMN "currency" SET NOT NULL;

ALTER TABLE "RecurringTransaction"
  ALTER COLUMN "version" SET DEFAULT 1,
  ALTER COLUMN "version" SET NOT NULL;

ALTER TABLE "Income"
  ADD CONSTRAINT "Income_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "Income_currency_check" CHECK (char_length("currency") = 3);

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "Expense_currency_check" CHECK (char_length("currency") = 3);

ALTER TABLE "RecurringTransaction"
  ADD CONSTRAINT "RecurringTransaction_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "RecurringTransaction_interval_check" CHECK ("interval" > 0);

ALTER TABLE "Family"
  ADD CONSTRAINT "Family_baseCurrency_check" CHECK (char_length("baseCurrency") = 3);
