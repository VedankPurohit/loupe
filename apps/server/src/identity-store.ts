import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  bootstrapCredentials,
  browserSessions,
  organizationMembers,
  organizations,
} from "@workspace/database";
import type {
  AuthenticatedSessionResponse,
  BootstrapRedeemRequest,
} from "@workspace/contracts";

const scrypt = promisify(scryptCallback);
const bootstrapLifetimeMs = 24 * 60 * 60 * 1_000;
const browserSessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const injectedBootstrapCodePattern = /^bootstrap_[A-Za-z0-9_-]{43,}$/;

export class IdentityError extends Error {
  constructor(
    public readonly code:
      | "BOOTSTRAP_CODE_ALREADY_REDEEMED"
      | "BOOTSTRAP_CODE_INVALID",
    message: string,
  ) {
    super(message);
  }
}

export type Redemption = AuthenticatedSessionResponse & { sessionToken: string };

async function deriveVerifier(secret: string, salt: string): Promise<Buffer> {
  return (await scrypt(secret, salt, 64)) as Buffer;
}

function digestSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export class IdentityStore {
  private readonly client;
  private readonly database;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl);
    this.database = drizzle(this.client);
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async bootstrapRequired(): Promise<boolean> {
    const [organization] = await this.database
      .select({ id: organizations.id })
      .from(organizations)
      .limit(1);
    return organization === undefined;
  }

  async ensureBootstrapCode(requestedCode?: string): Promise<string | undefined> {
    if (
      requestedCode !== undefined &&
      !injectedBootstrapCodePattern.test(requestedCode)
    ) {
      throw new Error(
        'BOOTSTRAP_CODE must start with "bootstrap_" and contain at least 43 URL-safe characters after the prefix.',
      );
    }
    if (!(await this.bootstrapRequired())) return undefined;

    const [activeCredential] = await this.database
      .select({
        id: bootstrapCredentials.id,
        expiresAt: bootstrapCredentials.expiresAt,
        redeemedAt: bootstrapCredentials.redeemedAt,
        revokedAt: bootstrapCredentials.revokedAt,
      })
      .from(bootstrapCredentials)
      .where(eq(bootstrapCredentials.active, true))
      .limit(1);
    if (
      activeCredential &&
      activeCredential.expiresAt > new Date() &&
      activeCredential.redeemedAt === null &&
      activeCredential.revokedAt === null
    ) {
      return undefined;
    }
    if (activeCredential) {
      await this.database
        .update(bootstrapCredentials)
        .set({ active: false })
        .where(eq(bootstrapCredentials.id, activeCredential.id));
    }

    const code = requestedCode ?? `bootstrap_${randomBytes(32).toString("base64url")}`;
    const salt = randomBytes(24).toString("base64url");
    const verifierDigest = (await deriveVerifier(code, salt)).toString("base64url");
    const inserted = await this.database
      .insert(bootstrapCredentials)
      .values({
        verifierSalt: salt,
        verifierDigest,
        expiresAt: new Date(Date.now() + bootstrapLifetimeMs),
      })
      .onConflictDoNothing()
      .returning({ id: bootstrapCredentials.id });

    return inserted.length === 1 ? code : undefined;
  }

  async redeemBootstrap(input: BootstrapRedeemRequest): Promise<Redemption> {
    return this.database.transaction(async (transaction) => {
      const [existingOrganization] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .limit(1);
      if (existingOrganization) {
        throw new IdentityError(
          "BOOTSTRAP_CODE_ALREADY_REDEEMED",
          "Bootstrap has already been completed.",
        );
      }

      const [credential] = await transaction
        .select()
        .from(bootstrapCredentials)
        .where(
          and(
            eq(bootstrapCredentials.active, true),
            isNull(bootstrapCredentials.redeemedAt),
            isNull(bootstrapCredentials.revokedAt),
            gt(bootstrapCredentials.expiresAt, new Date()),
          ),
        )
        .for("update")
        .limit(1);

      if (!credential) {
        const [completedOrganization] = await transaction
          .select({ id: organizations.id })
          .from(organizations)
          .limit(1);
        if (completedOrganization) {
          throw new IdentityError(
            "BOOTSTRAP_CODE_ALREADY_REDEEMED",
            "Bootstrap has already been completed.",
          );
        }
        throw new IdentityError(
          "BOOTSTRAP_CODE_INVALID",
          "The Bootstrap code is invalid, expired, or revoked.",
        );
      }

      const expected = Buffer.from(credential.verifierDigest, "base64url");
      const supplied = await deriveVerifier(input.code, credential.verifierSalt);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        throw new IdentityError(
          "BOOTSTRAP_CODE_INVALID",
          "The Bootstrap code is invalid, expired, or revoked.",
        );
      }

      const [organization] = await transaction
        .insert(organizations)
        .values({ name: input.organization.name })
        .returning({ id: organizations.id, name: organizations.name });
      const [member] = await transaction
        .insert(organizationMembers)
        .values({
          organizationId: organization!.id,
          displayName: input.administrator.displayName,
          role: "administrator",
        })
        .returning({
          id: organizationMembers.id,
          displayName: organizationMembers.displayName,
          role: organizationMembers.role,
        });

      const sessionToken = `session_${randomBytes(32).toString("base64url")}`;
      await transaction.insert(browserSessions).values({
        memberId: member!.id,
        tokenDigest: digestSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + browserSessionLifetimeMs),
      });
      await transaction
        .update(bootstrapCredentials)
        .set({ active: false, redeemedAt: new Date() })
        .where(eq(bootstrapCredentials.id, credential.id));

      return { organization: organization!, member: member!, sessionToken };
    });
  }

  async getSession(token: string): Promise<AuthenticatedSessionResponse | undefined> {
    const [session] = await this.database
      .select({
        organizationId: organizations.id,
        organizationName: organizations.name,
        memberId: organizationMembers.id,
        memberDisplayName: organizationMembers.displayName,
        memberRole: organizationMembers.role,
      })
      .from(browserSessions)
      .innerJoin(
        organizationMembers,
        eq(browserSessions.memberId, organizationMembers.id),
      )
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(
        and(
          eq(browserSessions.tokenDigest, digestSessionToken(token)),
          isNull(browserSessions.revokedAt),
          gt(browserSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) return undefined;
    return {
      organization: {
        id: session.organizationId,
        name: session.organizationName,
      },
      member: {
        id: session.memberId,
        displayName: session.memberDisplayName,
        role: session.memberRole,
      },
    };
  }
}
