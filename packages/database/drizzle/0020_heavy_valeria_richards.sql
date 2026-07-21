CREATE TABLE "analysis_credential_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"lookup" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"verifier_salt" varchar(128) NOT NULL,
	"verifier_digest" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "analysis_credential_grants" ADD CONSTRAINT "analysis_credential_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_credential_grants" ADD CONSTRAINT "analysis_credential_grants_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_credential_grants" ADD CONSTRAINT "analysis_credential_grants_member_organization_fk" FOREIGN KEY ("member_id","organization_id") REFERENCES "public"."organization_members"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_credential_grants_lookup_unique" ON "analysis_credential_grants" USING btree ("lookup");--> statement-breakpoint
CREATE INDEX "analysis_credential_grants_member_idx" ON "analysis_credential_grants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "analysis_credential_grants_organization_idx" ON "analysis_credential_grants" USING btree ("organization_id");