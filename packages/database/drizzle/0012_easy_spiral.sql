ALTER TABLE "device_standard_installations" ADD COLUMN "standard_id" uuid;--> statement-breakpoint
-- Legacy reports predate per-standard correlation. Preserve reports whose release
-- identity determines one standard and discard only rows that cannot be safely
-- attributed to a single standard.
DELETE FROM "device_standard_installations" AS "installation"
USING "organization_standard_releases" AS "target", "organization_standard_releases" AS "installed"
WHERE "installation"."release_id" = "target"."id"
  AND "installation"."installed_release_id" = "installed"."id"
  AND "target"."standard_id" <> "installed"."standard_id";--> statement-breakpoint
UPDATE "device_standard_installations" AS "installation"
SET "standard_id" = "release"."standard_id"
FROM "organization_standard_releases" AS "release"
WHERE "release"."id" = COALESCE("installation"."release_id", "installation"."installed_release_id");--> statement-breakpoint
DELETE FROM "device_standard_installations" WHERE "standard_id" IS NULL;--> statement-breakpoint
ALTER TABLE "device_standard_installations" ALTER COLUMN "standard_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "device_standard_installations" ADD CONSTRAINT "device_standard_installations_standard_id_organization_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."organization_standards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_standard_installations_standard_idx" ON "device_standard_installations" USING btree ("standard_id");
