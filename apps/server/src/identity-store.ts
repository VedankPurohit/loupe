import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  analysisCredentials,
  bootstrapCredentials,
  browserSessions,
  capturedRecords,
  deviceCredentials,
  deviceEnrollmentGrants,
  enrolledDevices,
  inviteCredentials,
  organizationMembers,
  organizations,
  sourceEvents,
} from "@workspace/database";
import { SourceEventSchema } from "@workspace/contracts";
import type {
  AnalysisCredential,
  AnalysisCredentialCreateRequest,
  AnalysisCredentialCreateResponse,
  AuthenticatedSessionResponse,
  BootstrapRedeemRequest,
  CaptureRecord,
  DeviceEnrollmentGrantRequest,
  DeviceEnrollmentGrantResponse,
  DeviceEnrollmentResponse,
  EnrolledDevice,
  InviteCodeRedeemRequest,
  InviteCodeRequest,
  InviteCodeResponse,
  RetainedSourceEvent,
  SourceEventBatchResult,
  UpdateDeviceCapturePolicyRequest,
} from "@workspace/contracts";

const scrypt = promisify(scryptCallback);
const bootstrapLifetimeMs = 24 * 60 * 60 * 1_000;
const browserSessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const deviceEnrollmentGrantLifetimeMs = 10 * 60 * 1_000;
const injectedBootstrapCodePattern = /^bootstrap_[A-Za-z0-9_-]{43,}$/;
const enrollmentGrantPattern = /^enroll_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/;
const inviteCodePattern = /^invite_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/;
const analysisScopes = [
  "organization:evidence:read",
  "candidate:submit",
] as const;

export class IdentityError extends Error {
  constructor(
    public readonly code:
      | "BOOTSTRAP_CODE_ALREADY_REDEEMED"
      | "BOOTSTRAP_CODE_INVALID"
      | "DEVICE_ENROLLMENT_GRANT_INVALID"
      | "INVITE_CODE_INVALID"
      | "ADMINISTRATOR_REQUIRED",
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

function toEnrolledDevice(device: {
  id: string;
  memberId: string;
  name: string;
  policyVersion: number;
  ordinaryRedactionEnabled: boolean;
  demoCanaryEnabled: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}): EnrolledDevice {
  return {
    id: device.id,
    memberId: device.memberId,
    name: device.name,
    health: device.revokedAt ? "revoked" : "healthy",
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
    capturePolicy: {
      version: device.policyVersion,
      ordinaryRedactionEnabled: device.ordinaryRedactionEnabled,
      demoCanaryEnabled: device.demoCanaryEnabled,
    },
  };
}

function toAnalysisCredential(credential: {
  id: string;
  memberId: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): AnalysisCredential {
  return {
    id: credential.id,
    memberId: credential.memberId,
    name: credential.name,
    scopes: [...analysisScopes],
    createdAt: credential.createdAt.toISOString(),
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
  };
}

export type AnalysisAuthentication = AuthenticatedSessionResponse & {
  analysisCredential: AnalysisCredential;
};

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

  async createAnalysisCredential(
    memberId: string,
    input: AnalysisCredentialCreateRequest,
  ): Promise<AnalysisCredentialCreateResponse | undefined> {
    const [member] = await this.database
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.id, memberId))
      .limit(1);
    if (!member) return undefined;
    const credential = `analysis_${randomBytes(32).toString("base64url")}`;
    const [created] = await this.database
      .insert(analysisCredentials)
      .values({
        organizationId: member.organizationId,
        memberId,
        name: input.name,
        tokenDigest: digestSessionToken(credential),
      })
      .returning();
    return {
      credential,
      analysisCredential: toAnalysisCredential(created!),
    };
  }

  async listAnalysisCredentials(memberId: string): Promise<AnalysisCredential[]> {
    const rows = await this.database
      .select()
      .from(analysisCredentials)
      .where(eq(analysisCredentials.memberId, memberId))
      .orderBy(asc(analysisCredentials.createdAt));
    return rows.map(toAnalysisCredential);
  }

  async revokeAnalysisCredential(
    memberId: string,
    credentialId: string,
  ): Promise<boolean> {
    const [revoked] = await this.database
      .update(analysisCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(analysisCredentials.id, credentialId),
          eq(analysisCredentials.memberId, memberId),
          isNull(analysisCredentials.revokedAt),
        ),
      )
      .returning({ id: analysisCredentials.id });
    return revoked !== undefined;
  }

  async authenticateAnalysis(
    token: string,
  ): Promise<AnalysisAuthentication | undefined> {
    const [authentication] = await this.database
      .select({
        organizationId: organizations.id,
        organizationName: organizations.name,
        memberId: organizationMembers.id,
        memberDisplayName: organizationMembers.displayName,
        memberRole: organizationMembers.role,
        credential: analysisCredentials,
      })
      .from(analysisCredentials)
      .innerJoin(
        organizationMembers,
        eq(analysisCredentials.memberId, organizationMembers.id),
      )
      .innerJoin(
        organizations,
        eq(analysisCredentials.organizationId, organizations.id),
      )
      .where(
        and(
          eq(analysisCredentials.tokenDigest, digestSessionToken(token)),
          isNull(analysisCredentials.revokedAt),
        ),
      )
      .limit(1);
    if (!authentication) return undefined;
    const now = new Date();
    await this.database
      .update(analysisCredentials)
      .set({ lastUsedAt: now })
      .where(eq(analysisCredentials.id, authentication.credential.id));
    return {
      organization: {
        id: authentication.organizationId,
        name: authentication.organizationName,
      },
      member: {
        id: authentication.memberId,
        displayName: authentication.memberDisplayName,
        role: authentication.memberRole,
      },
      analysisCredential: toAnalysisCredential({
        ...authentication.credential,
        lastUsedAt: now,
      }),
    };
  }

  async createInviteCode(
    administratorId: string,
    input: InviteCodeRequest,
  ): Promise<InviteCodeResponse> {
    const [administrator] = await this.database
      .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.id, administratorId))
      .limit(1);
    if (!administrator || administrator.role !== "administrator") {
      throw new IdentityError(
        "ADMINISTRATOR_REQUIRED",
        "An Administrator browser session is required.",
      );
    }

    const lookup = randomBytes(12).toString("base64url");
    const code = `invite_${lookup}_${randomBytes(32).toString("base64url")}`;
    const salt = randomBytes(24).toString("base64url");
    const verifierDigest = (await deriveVerifier(code, salt)).toString("base64url");
    const expiresAt = new Date(
      Date.now() + (input.expiresInHours ?? 24) * 60 * 60 * 1_000,
    );
    await this.database.insert(inviteCredentials).values({
      organizationId: administrator.organizationId,
      issuedByMemberId: administratorId,
      lookup,
      verifierSalt: salt,
      verifierDigest,
      expiresAt,
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async redeemInviteCode(input: InviteCodeRedeemRequest): Promise<Redemption> {
    const match = inviteCodePattern.exec(input.code);
    if (!match) {
      throw new IdentityError(
        "INVITE_CODE_INVALID",
        "The Invite code is invalid, expired, revoked, or already used.",
      );
    }

    return this.database.transaction(async (transaction) => {
      const [credential] = await transaction
        .select()
        .from(inviteCredentials)
        .where(
          and(
            eq(inviteCredentials.lookup, match[1]!),
            isNull(inviteCredentials.redeemedAt),
            isNull(inviteCredentials.revokedAt),
            gt(inviteCredentials.expiresAt, new Date()),
          ),
        )
        .for("update")
        .limit(1);
      if (!credential) {
        throw new IdentityError(
          "INVITE_CODE_INVALID",
          "The Invite code is invalid, expired, revoked, or already used.",
        );
      }

      const expected = Buffer.from(credential.verifierDigest, "base64url");
      const supplied = await deriveVerifier(input.code, credential.verifierSalt);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        throw new IdentityError(
          "INVITE_CODE_INVALID",
          "The Invite code is invalid, expired, revoked, or already used.",
        );
      }

      const [organization] = await transaction
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, credential.organizationId))
        .limit(1);
      if (!organization) {
        throw new IdentityError(
          "INVITE_CODE_INVALID",
          "The Invite code is invalid, expired, revoked, or already used.",
        );
      }
      const [member] = await transaction
        .insert(organizationMembers)
        .values({
          organizationId: credential.organizationId,
          displayName: input.member.displayName,
          role: "member",
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
        .update(inviteCredentials)
        .set({ redeemedAt: new Date() })
        .where(eq(inviteCredentials.id, credential.id));
      return { organization, member: member!, sessionToken };
    });
  }

  async createDeviceEnrollmentGrant(
    memberId: string,
    input: DeviceEnrollmentGrantRequest,
  ): Promise<DeviceEnrollmentGrantResponse> {
    const lookup = randomBytes(12).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const grant = `enroll_${lookup}_${secret}`;
    const salt = randomBytes(24).toString("base64url");
    const verifierDigest = (await deriveVerifier(grant, salt)).toString("base64url");
    const expiresAt = new Date(Date.now() + deviceEnrollmentGrantLifetimeMs);

    await this.database.insert(deviceEnrollmentGrants).values({
      memberId,
      lookup,
      deviceName: input.deviceName,
      verifierSalt: salt,
      verifierDigest,
      expiresAt,
    });

    return { grant, expiresAt: expiresAt.toISOString() };
  }

  async redeemDeviceEnrollmentGrant(
    grant: string,
  ): Promise<DeviceEnrollmentResponse> {
    const match = enrollmentGrantPattern.exec(grant);
    if (!match) {
      throw new IdentityError(
        "DEVICE_ENROLLMENT_GRANT_INVALID",
        "The device-enrollment grant is invalid, expired, revoked, or already used.",
      );
    }

    return this.database.transaction(async (transaction) => {
      const [enrollmentGrant] = await transaction
        .select()
        .from(deviceEnrollmentGrants)
        .where(
          and(
            eq(deviceEnrollmentGrants.lookup, match[1]!),
            isNull(deviceEnrollmentGrants.redeemedAt),
            isNull(deviceEnrollmentGrants.revokedAt),
            gt(deviceEnrollmentGrants.expiresAt, new Date()),
          ),
        )
        .for("update")
        .limit(1);

      if (!enrollmentGrant) {
        throw new IdentityError(
          "DEVICE_ENROLLMENT_GRANT_INVALID",
          "The device-enrollment grant is invalid, expired, revoked, or already used.",
        );
      }

      const expected = Buffer.from(enrollmentGrant.verifierDigest, "base64url");
      const supplied = await deriveVerifier(grant, enrollmentGrant.verifierSalt);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        throw new IdentityError(
          "DEVICE_ENROLLMENT_GRANT_INVALID",
          "The device-enrollment grant is invalid, expired, revoked, or already used.",
        );
      }

      const [member] = await transaction
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.id, enrollmentGrant.memberId))
        .limit(1);
      if (!member) {
        throw new IdentityError(
          "DEVICE_ENROLLMENT_GRANT_INVALID",
          "The device-enrollment grant is invalid, expired, revoked, or already used.",
        );
      }

      const [device] = await transaction
        .insert(enrolledDevices)
        .values({
          organizationId: member.organizationId,
          memberId: enrollmentGrant.memberId,
          name: enrollmentGrant.deviceName,
        })
        .returning();
      const credential = `device_${randomBytes(32).toString("base64url")}`;
      await transaction.insert(deviceCredentials).values({
        deviceId: device!.id,
        tokenDigest: digestSessionToken(credential),
      });
      await transaction
        .update(deviceEnrollmentGrants)
        .set({ redeemedAt: new Date() })
        .where(eq(deviceEnrollmentGrants.id, enrollmentGrant.id));

      return { credential, device: toEnrolledDevice(device!) };
    });
  }

  async authenticateDevice(token: string): Promise<EnrolledDevice | undefined> {
    const [device] = await this.database
      .select({
        id: enrolledDevices.id,
        memberId: enrolledDevices.memberId,
        name: enrolledDevices.name,
        policyVersion: enrolledDevices.policyVersion,
        ordinaryRedactionEnabled: enrolledDevices.ordinaryRedactionEnabled,
        demoCanaryEnabled: enrolledDevices.demoCanaryEnabled,
        createdAt: enrolledDevices.createdAt,
        lastSeenAt: enrolledDevices.lastSeenAt,
        revokedAt: enrolledDevices.revokedAt,
        credentialId: deviceCredentials.id,
      })
      .from(deviceCredentials)
      .innerJoin(enrolledDevices, eq(deviceCredentials.deviceId, enrolledDevices.id))
      .where(
        and(
          eq(deviceCredentials.tokenDigest, digestSessionToken(token)),
          isNull(deviceCredentials.revokedAt),
          isNull(enrolledDevices.revokedAt),
        ),
      )
      .limit(1);

    if (!device) return undefined;
    const now = new Date();
    await this.database
      .update(deviceCredentials)
      .set({ lastUsedAt: now })
      .where(eq(deviceCredentials.id, device.credentialId));
    await this.database
      .update(enrolledDevices)
      .set({ lastSeenAt: now })
      .where(eq(enrolledDevices.id, device.id));

    return toEnrolledDevice({ ...device, lastSeenAt: now });
  }

  async deviceOrganizationId(deviceId: string): Promise<string | undefined> {
    const [device] = await this.database
      .select({ organizationId: enrolledDevices.organizationId })
      .from(enrolledDevices)
      .where(eq(enrolledDevices.id, deviceId))
      .limit(1);
    return device?.organizationId;
  }

  async listDevices(memberId: string): Promise<EnrolledDevice[]> {
    const devices = await this.database
      .select()
      .from(enrolledDevices)
      .where(eq(enrolledDevices.memberId, memberId))
      .orderBy(asc(enrolledDevices.createdAt));
    return devices.map(toEnrolledDevice);
  }

  async updateDeviceCapturePolicy(
    memberId: string,
    deviceId: string,
    input: UpdateDeviceCapturePolicyRequest,
  ): Promise<EnrolledDevice["capturePolicy"] | undefined> {
    const [current] = await this.database
      .select()
      .from(enrolledDevices)
      .where(
        and(
          eq(enrolledDevices.id, deviceId),
          eq(enrolledDevices.memberId, memberId),
          isNull(enrolledDevices.revokedAt),
        ),
      )
      .limit(1);
    if (!current) return undefined;

    const ordinaryRedactionEnabled =
      input.ordinaryRedactionEnabled ?? current.ordinaryRedactionEnabled;
    const demoCanaryEnabled =
      input.demoCanaryEnabled ?? current.demoCanaryEnabled;
    if (
      ordinaryRedactionEnabled === current.ordinaryRedactionEnabled &&
      demoCanaryEnabled === current.demoCanaryEnabled
    ) {
      return toEnrolledDevice(current).capturePolicy;
    }

    const [updated] = await this.database
      .update(enrolledDevices)
      .set({
        ordinaryRedactionEnabled,
        demoCanaryEnabled,
        policyVersion: sql`${enrolledDevices.policyVersion} + 1`,
      })
      .where(
        and(
          eq(enrolledDevices.id, deviceId),
          eq(enrolledDevices.memberId, memberId),
          isNull(enrolledDevices.revokedAt),
        ),
      )
      .returning();
    return updated ? toEnrolledDevice(updated).capturePolicy : undefined;
  }

  async revokeDevice(memberId: string, deviceId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [device] = await transaction
        .select({ id: enrolledDevices.id })
        .from(enrolledDevices)
        .where(
          and(
            eq(enrolledDevices.id, deviceId),
            eq(enrolledDevices.memberId, memberId),
            isNull(enrolledDevices.revokedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!device) return false;
      const revokedAt = new Date();
      await transaction
        .update(deviceCredentials)
        .set({ revokedAt })
        .where(
          and(
            eq(deviceCredentials.deviceId, deviceId),
            isNull(deviceCredentials.revokedAt),
          ),
        );
      await transaction
        .update(enrolledDevices)
        .set({ revokedAt })
        .where(eq(enrolledDevices.id, deviceId));
      return true;
    });
  }

  async persistCaptureRecord(
    deviceId: string,
    capture: CaptureRecord,
  ): Promise<boolean> {
    const [device] = await this.database
      .select({
        organizationId: enrolledDevices.organizationId,
        memberId: enrolledDevices.memberId,
      })
      .from(enrolledDevices)
      .where(
        and(
          eq(enrolledDevices.id, deviceId),
          isNull(enrolledDevices.revokedAt),
        ),
      )
      .limit(1);
    if (!device) return false;

    await this.database
      .insert(capturedRecords)
      .values({
        id: capture.id,
        organizationId: device.organizationId,
        memberId: device.memberId,
        deviceId,
        source: capture.source,
        content: capture.content,
        sourcePath: capture.sourcePath,
        capturedAt: new Date(capture.capturedAt),
        policyVersion: capture.policyVersion,
        redactions: capture.redactions,
      })
      .onConflictDoNothing({ target: capturedRecords.id });
    return true;
  }

  async getCaptureRecord(
    organizationId: string,
    captureId: string,
  ): Promise<CaptureRecord | undefined> {
    const [capture] = await this.database
      .select()
      .from(capturedRecords)
      .where(
        and(
          eq(capturedRecords.id, captureId),
          eq(capturedRecords.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!capture) return undefined;
    return {
      id: capture.id,
      source: capture.source as CaptureRecord["source"],
      content: capture.content,
      sourcePath: capture.sourcePath,
      capturedAt: capture.capturedAt.toISOString(),
      policyVersion: capture.policyVersion,
      redactions: capture.redactions as CaptureRecord["redactions"],
    };
  }

  async persistSourceEventBatch(
    deviceId: string,
    batchId: string,
    candidates: unknown[],
  ): Promise<SourceEventBatchResult[] | undefined> {
    const [device] = await this.database
      .select({
        organizationId: enrolledDevices.organizationId,
        memberId: enrolledDevices.memberId,
      })
      .from(enrolledDevices)
      .where(
        and(eq(enrolledDevices.id, deviceId), isNull(enrolledDevices.revokedAt)),
      )
      .limit(1);
    if (!device) return undefined;

    return this.database.transaction(async (transaction) => {
      const results: SourceEventBatchResult[] = [];
      for (const candidate of candidates) {
        const eventId =
          typeof candidate === "object" &&
          candidate !== null &&
          "id" in candidate &&
          typeof candidate.id === "string"
            ? candidate.id
            : `invalid-event-${results.length + 1}`;
        const parsed = SourceEventSchema.safeParse(candidate);
        if (!parsed.success) {
          const unsupportedVersion =
            typeof candidate === "object" &&
            candidate !== null &&
            "schemaVersion" in candidate &&
            candidate.schemaVersion !== "1";
          results.push({
            eventId,
            status: "rejected",
            retryable: false,
            code: unsupportedVersion
              ? "SOURCE_EVENT_UNSUPPORTED_SCHEMA_VERSION"
              : "SOURCE_EVENT_INVALID",
            message: unsupportedVersion
              ? "The source-event schema version is not supported."
              : "The source event did not match the ingestion contract.",
          });
          continue;
        }
        const event = parsed.data;
        const computedPayloadHash = `sha256:${createHash("sha256")
          .update(JSON.stringify(event.rawPayload))
          .digest("hex")}`;
        if (computedPayloadHash !== event.payloadHash) {
          results.push({
            eventId: event.id,
            status: "rejected",
            retryable: false,
            code: "SOURCE_EVENT_PAYLOAD_HASH_MISMATCH",
            message: "The source payload does not match its integrity evidence.",
          });
          continue;
        }
        const inserted = await transaction
          .insert(sourceEvents)
          .values({
            id: event.id,
            organizationId: device.organizationId,
            memberId: device.memberId,
            deliveringDeviceId: deviceId,
            batchId,
            schemaVersion: event.schemaVersion,
            deduplicationKey: event.deduplicationKey,
            payloadHash: event.payloadHash,
            source: event.source,
            producerName: event.producer.name,
            producerVersion: event.producer.version,
            producerEvent: event.producer.event,
            parserName: event.parser.name,
            parserVersion: event.parser.version,
            occurredAt: new Date(event.occurredAt),
            capturedAt: new Date(event.capturedAt),
            capturePath: event.capturePath,
            rawPayload: event.rawPayload,
            canonicalObservations: event.canonicalObservations,
            adapter: event.adapter,
            redaction: event.redaction,
            gitContext: event.gitContext ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: sourceEvents.id });
        if (inserted.length === 1) {
          results.push({ eventId: event.id, status: "accepted" });
          continue;
        }
        const [existing] = await transaction
          .select({
            id: sourceEvents.id,
            deduplicationKey: sourceEvents.deduplicationKey,
            payloadHash: sourceEvents.payloadHash,
          })
          .from(sourceEvents)
          .where(
            and(
              eq(sourceEvents.organizationId, device.organizationId),
              or(
                eq(sourceEvents.id, event.id),
                eq(sourceEvents.deduplicationKey, event.deduplicationKey),
              ),
            ),
          )
          .limit(1);
        if (
          existing?.id === event.id &&
          existing.deduplicationKey === event.deduplicationKey &&
          existing.payloadHash === event.payloadHash
        ) {
          results.push({ eventId: event.id, status: "duplicate" });
        } else {
          results.push({
            eventId: event.id,
            status: "rejected",
            retryable: false,
            code: "SOURCE_EVENT_DEDUPLICATION_CONFLICT",
            message: "Delivery identity was already used for different evidence.",
          });
        }
      }
      return results;
    });
  }

  async getSourceEvent(
    organizationId: string,
    eventId: string,
  ): Promise<RetainedSourceEvent | undefined> {
    const [event] = await this.database
      .select()
      .from(sourceEvents)
      .where(
        and(
          eq(sourceEvents.id, eventId),
          eq(sourceEvents.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!event) return undefined;
    return {
      schemaVersion: "1",
      id: event.id,
      deduplicationKey: event.deduplicationKey,
      payloadHash: event.payloadHash,
      source: event.source as RetainedSourceEvent["source"],
      producer: {
        name: "codex",
        version: event.producerVersion,
        event: event.producerEvent,
      },
      parser: { name: event.parserName, version: event.parserVersion },
      occurredAt: event.occurredAt.toISOString(),
      capturedAt: event.capturedAt.toISOString(),
      capturePath: event.capturePath,
      rawPayload: event.rawPayload as Record<string, unknown>,
      canonicalObservations: event.canonicalObservations as unknown[],
      adapter: event.adapter as RetainedSourceEvent["adapter"],
      redaction: event.redaction as RetainedSourceEvent["redaction"],
      gitContext:
        (event.gitContext as RetainedSourceEvent["gitContext"]) ?? undefined,
      receivedAt: event.receivedAt.toISOString(),
      delivery: { deviceId: event.deliveringDeviceId, batchId: event.batchId },
    };
  }
}
