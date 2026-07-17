CREATE TABLE "example_pack_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" text NOT NULL,
	"imported_by_member_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"canonical_session_id" text NOT NULL,
	"outcome" varchar(16) DEFAULT 'unknown' NOT NULL,
	"review_status" varchar(16) DEFAULT 'ordinary' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by_member_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_sessions" ALTER COLUMN "owner_device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD COLUMN "is_seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD COLUMN "example_pack_version" text;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "is_example" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "example_pack_version" text;--> statement-breakpoint
ALTER TABLE "example_pack_imports" ADD CONSTRAINT "example_pack_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "example_pack_imports" ADD CONSTRAINT "example_pack_imports_imported_by_member_id_organization_members_id_fk" FOREIGN KEY ("imported_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_annotations" ADD CONSTRAINT "session_annotations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_annotations" ADD CONSTRAINT "session_annotations_updated_by_member_id_organization_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "example_pack_imports_org_version_unique" ON "example_pack_imports" USING btree ("organization_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "session_annotations_org_session_unique" ON "session_annotations" USING btree ("organization_id","canonical_session_id");--> statement-breakpoint
CREATE INDEX "session_annotations_tags_idx" ON "session_annotations" USING gin ("tags");