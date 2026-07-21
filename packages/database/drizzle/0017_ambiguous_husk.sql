CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"profile_email" text,
	"profile_display_name" text NOT NULL,
	"profile_avatar_url" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "google_auth_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_digest" varchar(128) NOT NULL,
	"nonce_digest" varchar(128) NOT NULL,
	"csrf_digest" varchar(128) NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_provider_subject_unique" ON "external_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_person_provider_unique" ON "external_identities" USING btree ("person_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "google_auth_transactions_transaction_digest_unique" ON "google_auth_transactions" USING btree ("transaction_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "google_auth_transactions_nonce_digest_unique" ON "google_auth_transactions" USING btree ("nonce_digest");--> statement-breakpoint
CREATE INDEX "google_auth_transactions_expires_idx" ON "google_auth_transactions" USING btree ("expires_at");