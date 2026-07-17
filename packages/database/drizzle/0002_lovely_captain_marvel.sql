CREATE TABLE "captured_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"source_path" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"policy_version" integer NOT NULL,
	"redactions" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "captured_records" ADD CONSTRAINT "captured_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captured_records" ADD CONSTRAINT "captured_records_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captured_records" ADD CONSTRAINT "captured_records_device_id_enrolled_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."enrolled_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captured_records_organization_idx" ON "captured_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "captured_records_device_idx" ON "captured_records" USING btree ("device_id");