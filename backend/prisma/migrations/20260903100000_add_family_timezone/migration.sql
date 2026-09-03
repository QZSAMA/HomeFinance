ALTER TABLE "Family" ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai';

ALTER TABLE "Family"
  ADD CONSTRAINT "Family_timezone_nonblank" CHECK (length(trim("timezone")) > 0);

CREATE OR REPLACE FUNCTION prevent_family_timezone_update() RETURNS trigger AS $$
BEGIN
  IF NEW."timezone" IS DISTINCT FROM OLD."timezone" THEN
    RAISE EXCEPTION 'FAMILY_TIMEZONE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Family_timezone_immutable"
  BEFORE UPDATE OF "timezone" ON "Family"
  FOR EACH ROW EXECUTE FUNCTION prevent_family_timezone_update();
