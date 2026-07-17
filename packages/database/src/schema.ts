import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
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
