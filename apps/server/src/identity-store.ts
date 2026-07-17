import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  bootstrapCredentials,
  browserSessions,
  capturedRecords,
  deviceCredentials,
  deviceEnrollmentGrants,
  enrolledDevices,
  organizationMembers,
  organizations,
} from "@workspace/database";
import type {
  AuthenticatedSessionResponse,
  BootstrapRedeemRequest,
  CaptureRecord,
  DeviceEnrollmentGrantRequest,
  DeviceEnrollmentGrantResponse,
  DeviceEnrollmentResponse,
  EnrolledDevice,
  UpdateDeviceCapturePolicyRequest,
} from "@workspace/contracts";

const scrypt = promisify(scryptCallback);
const bootstrapLifetimeMs = 24 * 60 * 60 * 1_000;
const browserSessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const deviceEnrollmentGrantLifetimeMs = 10 * 60 * 1_000;
const injectedBootstrapCodePattern = /^bootstrap_[A-Za-z0-9_-]{43,}$/;
const enrollmentGrantPattern = /^enroll_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/;

export class IdentityError extends Error {
  constructor(
    public readonly code:
      | "BOOTSTRAP_CODE_ALREADY_REDEEMED"
      | "BOOTSTRAP_CODE_INVALID"
      | "DEVICE_ENROLLMENT_GRANT_INVALID",
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
}
