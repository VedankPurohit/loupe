CREATE TABLE "analysis_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_digest" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "analysis_credentials" ADD CONSTRAINT "analysis_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_credentials" ADD CONSTRAINT "analysis_credentials_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_credentials_token_digest_unique" ON "analysis_credentials" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "analysis_credentials_member_idx" ON "analysis_credentials" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "analysis_credentials_organization_idx" ON "analysis_credentials" USING btree ("organization_id");