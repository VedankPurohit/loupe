CREATE TABLE "synthetic_evidence_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"pack_version" text NOT NULL,
	"record_kind" varchar(48) NOT NULL,
	"ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synthetic_evidence_records" ADD CONSTRAINT "synthetic_evidence_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_evidence_records" ADD CONSTRAINT "synthetic_evidence_records_session_id_execution_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."execution_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "synthetic_evidence_session_kind_ordinal_unique" ON "synthetic_evidence_records" USING btree ("session_id","record_kind","ordinal");--> statement-breakpoint
CREATE INDEX "synthetic_evidence_org_session_idx" ON "synthetic_evidence_records" USING btree ("organization_id","session_id");