CREATE TABLE "source_event_ingestion_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delivering_device_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_ordinal" integer NOT NULL,
	"event_id" text NOT NULL,
	"canonical_session_id" text,
	"source" varchar(64),
	"producer_version" varchar(64),
	"producer_event" text,
	"deduplication_key" varchar(71),
	"payload_hash" varchar(71),
	"occurred_at" timestamp with time zone,
	"acceptance_disposition" varchar(16) NOT NULL,
	"acceptance_code" text,
	"accepted_source_event_id" uuid,
	"adapter_disposition" varchar(16),
	"adapter_reason" text,
	"field_presence" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_event_ingestion_attempts" ADD CONSTRAINT "source_event_ingestion_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_event_ingestion_attempts" ADD CONSTRAINT "source_event_ingestion_attempts_delivering_device_id_enrolled_devices_id_fk" FOREIGN KEY ("delivering_device_id") REFERENCES "public"."enrolled_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_event_ingestion_attempts" ADD CONSTRAINT "source_event_ingestion_attempts_accepted_source_event_id_source_events_id_fk" FOREIGN KEY ("accepted_source_event_id") REFERENCES "public"."source_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_event_attempts_org_batch_ordinal_unique" ON "source_event_ingestion_attempts" USING btree ("organization_id","batch_id","batch_ordinal");--> statement-breakpoint
CREATE INDEX "source_event_attempts_org_session_received_idx" ON "source_event_ingestion_attempts" USING btree ("organization_id","canonical_session_id","received_at");--> statement-breakpoint
CREATE INDEX "source_event_attempts_org_received_idx" ON "source_event_ingestion_attempts" USING btree ("organization_id","received_at");