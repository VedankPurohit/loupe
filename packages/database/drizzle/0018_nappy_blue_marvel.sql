ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_id_person_unique" UNIQUE("id","person_id");--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_active_membership_person_fk" FOREIGN KEY ("member_id","person_id") REFERENCES "public"."organization_members"("id","person_id") ON DELETE cascade ON UPDATE no action;
