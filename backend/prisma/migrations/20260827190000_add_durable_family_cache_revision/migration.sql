-- The revision lives in PostgreSQL so cache invalidation survives Redis outages,
-- process restarts, and requests served by different backend instances.
ALTER TABLE "Family" ADD COLUMN "cacheVersion" INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_family_cache_version()
RETURNS TRIGGER AS $$
DECLARE
  target_family_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_family_id := OLD."familyId";
  ELSE
    target_family_id := NEW."familyId";
  END IF;

  UPDATE "Family"
  SET "cacheVersion" = "cacheVersion" + 1
  WHERE "id" = target_family_id;

  IF TG_OP = 'UPDATE' AND OLD."familyId" IS DISTINCT FROM NEW."familyId" THEN
    UPDATE "Family"
    SET "cacheVersion" = "cacheVersion" + 1
    WHERE "id" = OLD."familyId";
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FamilyMember_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "FamilyMember"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "Income_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "Income"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "Expense_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "Expense"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "Asset_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "Asset"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "Liability_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "Liability"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "File_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "File"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "AiConversation_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "AiConversation"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "Budget_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "Budget"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "RecurringTransaction_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "RecurringTransaction"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();

CREATE TRIGGER "Goal_bump_family_cache_version"
AFTER INSERT OR UPDATE OR DELETE ON "Goal"
FOR EACH ROW EXECUTE FUNCTION bump_family_cache_version();
