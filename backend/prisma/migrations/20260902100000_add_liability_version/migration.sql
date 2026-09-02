ALTER TABLE "Liability" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Liability"
  ADD CONSTRAINT "Liability_version_check" CHECK ("version" > 0);
