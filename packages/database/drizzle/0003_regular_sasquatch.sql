CREATE TABLE "source_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"delivering_device_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"schema_version" varchar(16) NOT NULL,
	"deduplication_key" varchar(71) NOT NULL,
	"payload_hash" varchar(71) NOT NULL,
	"source" varchar(64) NOT NULL,
	"producer_name" varchar(64) NOT NULL,
	"producer_version" varchar(64) NOT NULL,
	"producer_event" text NOT NULL,
	"parser_name" varchar(128) NOT NULL,
	"parser_version" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"capture_path" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"canonical_observations" jsonb NOT NULL,
	"redaction" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_delivering_device_id_enrolled_devices_id_fk" FOREIGN KEY ("delivering_device_id") REFERENCES "public"."enrolled_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_events_organization_dedup_unique" ON "source_events" USING btree ("organization_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "source_events_organization_received_idx" ON "source_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "source_events_device_idx" ON "source_events" USING btree ("delivering_device_id");
--> statement-breakpoint
CREATE FUNCTION reject_source_event_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'source_events are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER source_events_immutable
BEFORE UPDATE OR DELETE ON "source_events"
FOR EACH ROW EXECUTE FUNCTION reject_source_event_mutation();
