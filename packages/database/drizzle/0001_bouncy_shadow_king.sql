CREATE TABLE "device_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"token_digest" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_enrollment_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"lookup" varchar(32) NOT NULL,
	"device_name" text NOT NULL,
	"verifier_salt" varchar(128) NOT NULL,
	"verifier_digest" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrolled_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"ordinary_redaction_enabled" boolean DEFAULT true NOT NULL,
	"demo_canary_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_enrolled_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."enrolled_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_enrollment_grants" ADD CONSTRAINT "device_enrollment_grants_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolled_devices" ADD CONSTRAINT "enrolled_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolled_devices" ADD CONSTRAINT "enrolled_devices_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_credentials_token_digest_unique" ON "device_credentials" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "device_credentials_device_idx" ON "device_credentials" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_enrollment_grants_lookup_unique" ON "device_enrollment_grants" USING btree ("lookup");--> statement-breakpoint
CREATE INDEX "device_enrollment_grants_member_idx" ON "device_enrollment_grants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "enrolled_devices_organization_idx" ON "enrolled_devices" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "enrolled_devices_member_idx" ON "enrolled_devices" USING btree ("member_id");