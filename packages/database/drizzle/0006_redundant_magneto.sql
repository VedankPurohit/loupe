CREATE TABLE "invite_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"issued_by_member_id" uuid NOT NULL,
	"lookup" varchar(32) NOT NULL,
	"verifier_salt" varchar(128) NOT NULL,
	"verifier_digest" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invite_credentials" ADD CONSTRAINT "invite_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_credentials" ADD CONSTRAINT "invite_credentials_issued_by_member_id_organization_members_id_fk" FOREIGN KEY ("issued_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_credentials_lookup_unique" ON "invite_credentials" USING btree ("lookup");--> statement-breakpoint
CREATE INDEX "invite_credentials_organization_idx" ON "invite_credentials" USING btree ("organization_id");