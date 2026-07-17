CREATE TABLE "candidate_skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" text NOT NULL,
	"artifact_hash" varchar(71) NOT NULL,
	"artifact" jsonb NOT NULL,
	"reviewer_context" text NOT NULL,
	"uncertainty" jsonb NOT NULL,
	"claims" jsonb NOT NULL,
	"citations" jsonb NOT NULL,
	"submitted_by_member_id" uuid NOT NULL,
	"analysis_credential_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_skill_versions" ADD CONSTRAINT "candidate_skill_versions_candidate_id_candidate_skills_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate_skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skill_versions" ADD CONSTRAINT "candidate_skill_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skill_versions" ADD CONSTRAINT "candidate_skill_versions_submitted_by_member_id_organization_members_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skill_versions" ADD CONSTRAINT "candidate_skill_versions_analysis_credential_id_analysis_credentials_id_fk" FOREIGN KEY ("analysis_credential_id") REFERENCES "public"."analysis_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_skill_versions_candidate_version_unique" ON "candidate_skill_versions" USING btree ("candidate_id","version");--> statement-breakpoint
CREATE INDEX "candidate_skill_versions_organization_idx" ON "candidate_skill_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_skills_org_name_unique" ON "candidate_skills" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "candidate_skills_organization_idx" ON "candidate_skills" USING btree ("organization_id");