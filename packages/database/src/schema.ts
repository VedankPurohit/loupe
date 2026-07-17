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
