ALTER TABLE "execution_sessions" ADD COLUMN "git_context" jsonb;--> statement-breakpoint
ALTER TABLE "source_events" ADD COLUMN "git_context" jsonb;