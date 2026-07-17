CREATE TABLE "activity_episodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"source" varchar(16) NOT NULL,
	"state" varchar(16) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source_event_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"codex_thread_id" text,
	"agent_type" text,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"identity_evidence" jsonb NOT NULL,
	"parent_status" varchar(16),
	"parent_agent_run_id" text,
	"parent_reconciliation" jsonb
);
--> statement-breakpoint
CREATE TABLE "execution_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"canonical_session_id" text NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"owner_device_id" uuid NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"activity_state" varchar(16) NOT NULL,
	"root_agent_run_id" text NOT NULL,
	"projection_version" varchar(32) NOT NULL,
	"ownership_reconciliation" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_timeline_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"turn_id" text,
	"agent_run_id" text,
	"evidence" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"canonical_turn_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"evidence" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_episodes" ADD CONSTRAINT "activity_episodes_session_id_execution_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."execution_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_episodes" ADD CONSTRAINT "activity_episodes_source_event_id_source_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."source_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_agent_runs" ADD CONSTRAINT "execution_agent_runs_session_id_execution_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."execution_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD CONSTRAINT "execution_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD CONSTRAINT "execution_sessions_owner_member_id_organization_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_sessions" ADD CONSTRAINT "execution_sessions_owner_device_id_enrolled_devices_id_fk" FOREIGN KEY ("owner_device_id") REFERENCES "public"."enrolled_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_timeline_events" ADD CONSTRAINT "execution_timeline_events_session_id_execution_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."execution_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_timeline_events" ADD CONSTRAINT "execution_timeline_events_source_event_id_source_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."source_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_turns" ADD CONSTRAINT "execution_turns_session_id_execution_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."execution_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_episodes_session_public_unique" ON "activity_episodes" USING btree ("session_id","public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_agent_runs_session_public_unique" ON "execution_agent_runs" USING btree ("session_id","public_id");--> statement-breakpoint
CREATE INDEX "execution_agent_runs_codex_thread_idx" ON "execution_agent_runs" USING btree ("codex_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_sessions_org_canonical_unique" ON "execution_sessions" USING btree ("organization_id","canonical_session_id");--> statement-breakpoint
CREATE INDEX "execution_sessions_org_last_observed_idx" ON "execution_sessions" USING btree ("organization_id","last_observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_timeline_source_event_unique" ON "execution_timeline_events" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "execution_timeline_session_occurred_idx" ON "execution_timeline_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_turns_session_canonical_unique" ON "execution_turns" USING btree ("session_id","canonical_turn_id");