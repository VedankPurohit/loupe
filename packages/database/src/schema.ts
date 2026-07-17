import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const memberRole = pgEnum("member_role", ["member", "administrator"]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singletonKey: integer("singleton_key").notNull().default(1),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organizations_singleton_key_unique").on(table.singletonKey),
    check("organizations_singleton_key_check", sql`${table.singletonKey} = 1`),
  ],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    role: memberRole("role").notNull(),
    isExample: boolean("is_example").notNull().default(false),
    examplePackVersion: text("example_pack_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("organization_members_organization_idx").on(table.organizationId)],
);

export const bootstrapCredentials = pgTable(
  "bootstrap_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    verifierSalt: varchar("verifier_salt", { length: 128 }).notNull(),
    verifierDigest: varchar("verifier_digest", { length: 128 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("bootstrap_credentials_one_active_unique")
      .on(table.active)
      .where(sql`${table.active} = true`),
  ],
);

export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "cascade" }),
    tokenDigest: varchar("token_digest", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("browser_sessions_token_digest_unique").on(table.tokenDigest)],
);

export const analysisCredentials = pgTable(
  "analysis_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    tokenDigest: varchar("token_digest", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("analysis_credentials_token_digest_unique").on(table.tokenDigest),
    index("analysis_credentials_member_idx").on(table.memberId),
    index("analysis_credentials_organization_idx").on(table.organizationId),
  ],
);

export const inviteCredentials = pgTable(
  "invite_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    issuedByMemberId: uuid("issued_by_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    lookup: varchar("lookup", { length: 32 }).notNull(),
    verifierSalt: varchar("verifier_salt", { length: 128 }).notNull(),
    verifierDigest: varchar("verifier_digest", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("invite_credentials_lookup_unique").on(table.lookup),
    index("invite_credentials_organization_idx").on(table.organizationId),
  ],
);

export const deviceEnrollmentGrants = pgTable(
  "device_enrollment_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "cascade" }),
    lookup: varchar("lookup", { length: 32 }).notNull(),
    deviceName: text("device_name").notNull(),
    verifierSalt: varchar("verifier_salt", { length: 128 }).notNull(),
    verifierDigest: varchar("verifier_digest", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("device_enrollment_grants_lookup_unique").on(table.lookup),
    index("device_enrollment_grants_member_idx").on(table.memberId),
  ],
);

export const enrolledDevices = pgTable(
  "enrolled_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    policyVersion: integer("policy_version").notNull().default(1),
    ordinaryRedactionEnabled: boolean("ordinary_redaction_enabled")
      .notNull()
      .default(true),
    demoCanaryEnabled: boolean("demo_canary_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("enrolled_devices_organization_idx").on(table.organizationId),
    index("enrolled_devices_member_idx").on(table.memberId),
  ],
);

export const deviceCredentials = pgTable(
  "device_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => enrolledDevices.id, { onDelete: "cascade" }),
    tokenDigest: varchar("token_digest", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("device_credentials_token_digest_unique").on(table.tokenDigest),
    index("device_credentials_device_idx").on(table.deviceId),
  ],
);

export const capturedRecords = pgTable(
  "captured_records",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => enrolledDevices.id, { onDelete: "restrict" }),
    source: varchar("source", { length: 32 }).notNull(),
    content: text("content").notNull(),
    sourcePath: text("source_path").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    policyVersion: integer("policy_version").notNull(),
    redactions: jsonb("redactions").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("captured_records_organization_idx").on(table.organizationId),
    index("captured_records_device_idx").on(table.deviceId),
  ],
);

export const sourceEvents = pgTable(
  "source_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    deliveringDeviceId: uuid("delivering_device_id")
      .notNull()
      .references(() => enrolledDevices.id, { onDelete: "restrict" }),
    batchId: uuid("batch_id").notNull(),
    schemaVersion: varchar("schema_version", { length: 16 }).notNull(),
    deduplicationKey: varchar("deduplication_key", { length: 71 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 71 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    producerName: varchar("producer_name", { length: 64 }).notNull(),
    producerVersion: varchar("producer_version", { length: 64 }).notNull(),
    producerEvent: text("producer_event").notNull(),
    parserName: varchar("parser_name", { length: 128 }).notNull(),
    parserVersion: varchar("parser_version", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    capturePath: text("capture_path").notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    canonicalObservations: jsonb("canonical_observations").notNull(),
    adapter: jsonb("adapter").notNull(),
    redaction: jsonb("redaction").notNull(),
    gitContext: jsonb("git_context"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_events_organization_dedup_unique").on(
      table.organizationId,
      table.deduplicationKey,
    ),
    index("source_events_organization_received_idx").on(
      table.organizationId,
      table.receivedAt,
    ),
    index("source_events_device_idx").on(table.deliveringDeviceId),
  ],
);

export const executionSessions = pgTable(
  "execution_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    canonicalSessionId: text("canonical_session_id").notNull(),
    ownerMemberId: uuid("owner_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    ownerDeviceId: uuid("owner_device_id")
      .references(() => enrolledDevices.id, { onDelete: "restrict" }),
    gitContext: jsonb("git_context"),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    activityState: varchar("activity_state", { length: 16 }).notNull(),
    rootAgentRunId: text("root_agent_run_id").notNull(),
    projectionVersion: varchar("projection_version", { length: 32 }).notNull(),
    ownershipReconciliation: jsonb("ownership_reconciliation").notNull(),
    isSeeded: boolean("is_seeded").notNull().default(false),
    examplePackVersion: text("example_pack_version"),
    searchText: text("search_text").notNull().default(""),
  },
  (table) => [
    uniqueIndex("execution_sessions_org_canonical_unique").on(
      table.organizationId,
      table.canonicalSessionId,
    ),
    index("execution_sessions_org_last_observed_idx").on(
      table.organizationId,
      table.lastObservedAt,
    ),
  ],
);

export const sessionAnnotations = pgTable(
  "session_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    canonicalSessionId: text("canonical_session_id").notNull(),
    outcome: varchar("outcome", { length: 16 }).notNull().default("unknown"),
    reviewStatus: varchar("review_status", { length: 16 })
      .notNull()
      .default("ordinary"),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    updatedByMemberId: uuid("updated_by_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("session_annotations_org_session_unique").on(
      table.organizationId,
      table.canonicalSessionId,
    ),
    index("session_annotations_tags_idx").using("gin", table.tags),
  ],
);

export const examplePackImports = pgTable(
  "example_pack_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    importedByMemberId: uuid("imported_by_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("example_pack_imports_org_version_unique").on(
      table.organizationId,
      table.version,
    ),
  ],
);

export const candidateSkills = pgTable(
  "candidate_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("candidate_skills_org_name_unique").on(
      table.organizationId,
      table.name,
    ),
    index("candidate_skills_organization_idx").on(table.organizationId),
  ],
);

export const candidateSkillVersions = pgTable(
  "candidate_skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidateSkills.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    artifactHash: varchar("artifact_hash", { length: 71 }).notNull(),
    artifact: jsonb("artifact").notNull(),
    reviewerContext: text("reviewer_context").notNull(),
    uncertainty: jsonb("uncertainty").notNull(),
    claims: jsonb("claims").notNull(),
    citations: jsonb("citations").notNull(),
    submittedByMemberId: uuid("submitted_by_member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "restrict" }),
    analysisCredentialId: uuid("analysis_credential_id")
      .notNull()
      .references(() => analysisCredentials.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("candidate_skill_versions_candidate_version_unique").on(
      table.candidateId,
      table.version,
    ),
    index("candidate_skill_versions_organization_idx").on(table.organizationId),
  ],
);

export const activityEpisodes = pgTable(
  "activity_episodes",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => executionSessions.id, { onDelete: "cascade" }),
    publicId: text("public_id").notNull(),
    source: varchar("source", { length: 16 }).notNull(),
    state: varchar("state", { length: 16 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => sourceEvents.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("activity_episodes_session_public_unique").on(
      table.sessionId,
      table.publicId,
    ),
  ],
);

export const executionTurns = pgTable(
  "execution_turns",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => executionSessions.id, { onDelete: "cascade" }),
    canonicalTurnId: text("canonical_turn_id").notNull(),
    agentRunId: text("agent_run_id").notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    evidence: jsonb("evidence").notNull(),
  },
  (table) => [
    uniqueIndex("execution_turns_session_canonical_unique").on(
      table.sessionId,
      table.canonicalTurnId,
    ),
  ],
);

export const executionAgentRuns = pgTable(
  "execution_agent_runs",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => executionSessions.id, { onDelete: "cascade" }),
    publicId: text("public_id").notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    codexThreadId: text("codex_thread_id"),
    agentType: text("agent_type"),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    identityEvidence: jsonb("identity_evidence").notNull(),
    parentStatus: varchar("parent_status", { length: 16 }),
    parentAgentRunId: text("parent_agent_run_id"),
    parentReconciliation: jsonb("parent_reconciliation"),
  },
  (table) => [
    uniqueIndex("execution_agent_runs_session_public_unique").on(
      table.sessionId,
      table.publicId,
    ),
    index("execution_agent_runs_codex_thread_idx").on(table.codexThreadId),
  ],
);

export const executionTimelineEvents = pgTable(
  "execution_timeline_events",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => executionSessions.id, { onDelete: "cascade" }),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => sourceEvents.id, { onDelete: "restrict" }),
    event: text("event").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    turnId: text("turn_id"),
    agentRunId: text("agent_run_id"),
    evidence: jsonb("evidence").notNull(),
  },
  (table) => [
    uniqueIndex("execution_timeline_source_event_unique").on(table.sourceEventId),
    index("execution_timeline_session_occurred_idx").on(
      table.sessionId,
      table.occurredAt,
    ),
  ],
);
