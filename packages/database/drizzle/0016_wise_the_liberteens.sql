CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_singleton_key_check";--> statement-breakpoint
DROP INDEX "organizations_singleton_key_unique";--> statement-breakpoint
ALTER TABLE "browser_sessions" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "person_id" uuid;--> statement-breakpoint
UPDATE "organization_members"
SET "person_id" = gen_random_uuid()
WHERE "is_example" = false;--> statement-breakpoint
INSERT INTO "persons" ("id", "display_name", "created_at", "updated_at")
SELECT "person_id", "display_name", "created_at", "created_at"
FROM "organization_members"
WHERE "person_id" IS NOT NULL;--> statement-breakpoint
UPDATE "browser_sessions" AS "browser_session"
SET "person_id" = "member"."person_id"
FROM "organization_members" AS "member"
WHERE "browser_session"."member_id" = "member"."id";--> statement-breakpoint
ALTER TABLE "browser_sessions" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "persons_email_profile_idx" ON "persons" USING btree ("email");--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_sessions_person_idx" ON "browser_sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "organization_members_person_idx" ON "organization_members" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_organization_person_unique" ON "organization_members" USING btree ("organization_id","person_id") WHERE "organization_members"."person_id" is not null;--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "singleton_key";--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_person_kind_check" CHECK (("organization_members"."is_example" = true and "organization_members"."person_id" is null) or ("organization_members"."is_example" = false and "organization_members"."person_id" is not null));
