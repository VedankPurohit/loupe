CREATE TABLE "candidate_version_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"state" varchar(24) NOT NULL,
	"artifact_hash" varchar(71) NOT NULL,
	"note" text,
	"decided_by_member_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_standard_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"release_id" uuid,
	"installed_release_id" uuid,
	"state" varchar(32) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"active_session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure" jsonb,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_standard_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"standard_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"candidate_version_id" uuid NOT NULL,
	"version" text NOT NULL,
	"artifact_hash" varchar(71) NOT NULL,
	"artifact" jsonb NOT NULL,
	"approved_by_member_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"name" text NOT NULL,
	"distribution_state" varchar(16) DEFAULT 'active' NOT NULL,
	"target_release_id" uuid,
	"previous_release_id" uuid,
	"manifest_sequence" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_skill_versions" ALTER COLUMN "analysis_credential_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_version_reviews" ADD CONSTRAINT "candidate_version_reviews_candidate_version_id_candidate_skill_versions_id_fk" FOREIGN KEY ("candidate_version_id") REFERENCES "public"."candidate_skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_version_reviews" ADD CONSTRAINT "candidate_version_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_version_reviews" ADD CONSTRAINT "candidate_version_reviews_decided_by_member_id_organization_members_id_fk" FOREIGN KEY ("decided_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_standard_installations" ADD CONSTRAINT "device_standard_installations_device_id_enrolled_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."enrolled_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_standard_installations" ADD CONSTRAINT "device_standard_installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_standard_installations" ADD CONSTRAINT "device_standard_installations_release_id_organization_standard_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."organization_standard_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_standard_installations" ADD CONSTRAINT "device_standard_installations_installed_release_id_organization_standard_releases_id_fk" FOREIGN KEY ("installed_release_id") REFERENCES "public"."organization_standard_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_standard_releases" ADD CONSTRAINT "organization_standard_releases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_standard_releases" ADD CONSTRAINT "organization_standard_releases_standard_id_organization_standards_id_fk" FOREIGN KEY ("standard_id") REFERENCES "public"."organization_standards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_standard_releases" ADD CONSTRAINT "organization_standard_releases_candidate_id_candidate_skills_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_standard_releases" ADD CONSTRAINT "organization_standard_releases_candidate_version_id_candidate_skill_versions_id_fk" FOREIGN KEY ("candidate_version_id") REFERENCES "public"."candidate_skill_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_standard_releases" ADD CONSTRAINT "organization_standard_releases_approved_by_member_id_organization_members_id_fk" FOREIGN KEY ("approved_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_standards" ADD CONSTRAINT "organization_standards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_standards" ADD CONSTRAINT "organization_standards_candidate_id_candidate_skills_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_version_reviews_version_unique" ON "candidate_version_reviews" USING btree ("candidate_version_id");--> statement-breakpoint
CREATE INDEX "candidate_version_reviews_organization_idx" ON "candidate_version_reviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "device_standard_installations_device_idx" ON "device_standard_installations" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_standard_installations_organization_idx" ON "device_standard_installations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_standard_releases_candidate_version_unique" ON "organization_standard_releases" USING btree ("candidate_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_standard_releases_standard_version_unique" ON "organization_standard_releases" USING btree ("standard_id","version");--> statement-breakpoint
CREATE INDEX "organization_standard_releases_organization_idx" ON "organization_standard_releases" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_standards_candidate_unique" ON "organization_standards" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_standards_org_name_unique" ON "organization_standards" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "organization_standards_organization_idx" ON "organization_standards" USING btree ("organization_id");