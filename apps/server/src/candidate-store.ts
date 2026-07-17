import { createHash } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type {
  CandidatePackage,
  CandidateReviewEditRequest,
  CandidateSubmissionRequest,
  CandidateSubmissionResponse,
  DeviceStandardArtifact,
  DeviceStandardInstallation,
  DeviceStandardInstallationReportRequest,
  DeviceStandardManifest,
  EvidenceCitation,
  OrganizationStandardDistribution,
  OrganizationStandardRelease,
} from "@workspace/contracts";
import {
  candidateSkills,
  candidateSkillVersions,
  candidateVersionReviews,
  deviceStandardInstallations,
  executionSessions,
  executionTimelineEvents,
  executionTurns,
  organizationStandardReleases,
  organizationStandards,
} from "@workspace/database";

export class CandidateError extends Error {
  constructor(
    public readonly code:
      | "CANDIDATE_PACKAGE_INCOMPLETE"
      | "CANDIDATE_PACKAGE_INVALID"
      | "CANDIDATE_CLAIMS_UNCITED"
      | "CANDIDATE_CITATION_INVALID"
      | "CANDIDATE_REPEATED_PATTERN_REQUIRES_TWO_REAL_TURNS"
      | "CANDIDATE_ARTIFACT_HASH_MISMATCH"
      | "CANDIDATE_VERSION_EXISTS"
      | "CANDIDATE_NOT_FOUND"
      | "CANDIDATE_REVIEW_ALREADY_DECIDED"
      | "CANDIDATE_APPROVAL_HASH_MISMATCH"
      | "STANDARD_NOT_FOUND"
      | "STANDARD_RELEASE_NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

function canonicalPackage(candidatePackage: CandidatePackage): CandidatePackage {
  return {
    files: [...candidatePackage.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}

export function hashCandidatePackage(candidatePackage: CandidatePackage): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalPackage(candidatePackage)))
    .digest("hex")}`;
}

function validateInstallablePackage(
  name: string,
  candidatePackage: CandidatePackage,
): CandidatePackage {
  if (candidatePackage.files.length === 0) {
    throw new CandidateError(
      "CANDIDATE_PACKAGE_INCOMPLETE",
      "A Candidate must contain a complete installable skill package, not prose alone.",
    );
  }
  const paths = new Set<string>();
  for (const file of candidatePackage.files) {
    if (
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
      paths.has(file.path)
    ) {
      throw new CandidateError(
        "CANDIDATE_PACKAGE_INVALID",
        "Candidate package paths must be unique safe relative paths.",
      );
    }
    paths.add(file.path);
  }
  const skillFile = candidatePackage.files.find((file) => file.path === "SKILL.md");
  if (!skillFile) {
    throw new CandidateError(
      "CANDIDATE_PACKAGE_INCOMPLETE",
      "The installable skill package must contain a root SKILL.md file.",
    );
  }
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(skillFile.content)?.[1];
  const frontmatterName = frontmatter
    ?.split("\n")
    .find((line) => line.startsWith("name:"))
    ?.slice("name:".length)
    .trim();
  const description = frontmatter
    ?.split("\n")
    .find((line) => line.startsWith("description:"))
    ?.slice("description:".length)
    .trim();
  if (frontmatterName !== name || !description) {
    throw new CandidateError(
      "CANDIDATE_PACKAGE_INVALID",
      "SKILL.md must have name and description frontmatter, and its name must match the Candidate.",
    );
  }
  return canonicalPackage(candidatePackage);
}

function validateClaimsAgainstCitations(
  claims: CandidateSubmissionRequest["claims"],
  citations: EvidenceCitation[],
): void {
  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  for (const claim of claims) {
    if (
      claim.citationIds.length === 0 ||
      claim.citationIds.some((citationId) => !byId.has(citationId))
    ) {
      throw new CandidateError(
        "CANDIDATE_CLAIMS_UNCITED",
        "Every factual Candidate claim must reference at least one submitted Evidence citation.",
      );
    }
    if (claim.classification !== "repeated_pattern") continue;
    const realTurns = new Set(
      claim.citationIds.flatMap((id) => {
        const citation = byId.get(id);
        return citation?.synthetic === "real"
          ? [`${citation.sessionId}\n${citation.turnId}`]
          : [];
      }),
    );
    if (realTurns.size < 2) {
      throw new CandidateError(
        "CANDIDATE_REPEATED_PATTERN_REQUIRES_TWO_REAL_TURNS",
        "A Repeated-pattern claim requires citations to two distinct real captured Turns; Seeded evidence is illustrative only.",
      );
    }
  }
}

function toResponse(
  candidate: typeof candidateSkills.$inferSelect,
  version: typeof candidateSkillVersions.$inferSelect,
  review?: typeof candidateVersionReviews.$inferSelect,
): CandidateSubmissionResponse {
  const reviewState =
    (review?.state as "rejected" | "approved" | undefined) ?? "pending_review";
  return {
    candidate: {
      id: candidate.id,
      name: candidate.name,
      status: reviewState,
      createdAt: candidate.createdAt.toISOString(),
      deepLink: `/?candidate=${encodeURIComponent(candidate.id)}&version=${encodeURIComponent(version.id)}`,
    },
    version: {
      id: version.id,
      version: version.version,
      immutable: true,
      artifactHash: version.artifactHash,
      package: version.artifact as CandidatePackage,
      reviewerContext: version.reviewerContext,
      uncertainty: version.uncertainty as CandidateSubmissionResponse["version"]["uncertainty"],
      claims: version.claims as CandidateSubmissionResponse["version"]["claims"],
      citations: version.citations as CandidateSubmissionResponse["version"]["citations"],
      submittedAt: version.submittedAt.toISOString(),
      submittedBy: {
        memberId: version.submittedByMemberId,
        analysisCredentialId: version.analysisCredentialId,
      },
      review: {
        state: reviewState,
        note: review?.note ?? null,
        decidedAt: review?.decidedAt.toISOString() ?? null,
        decidedByMemberId: review?.decidedByMemberId ?? null,
      },
    },
  };
}

function toRelease(
  standard: typeof organizationStandards.$inferSelect,
  release: typeof organizationStandardReleases.$inferSelect,
): OrganizationStandardRelease {
  return {
    standardId: standard.id,
    releaseId: release.id,
    candidateId: release.candidateId,
    candidateVersionId: release.candidateVersionId,
    name: standard.name,
    version: release.version,
    artifactHash: release.artifactHash,
    mandatory: true,
    immutable: true,
    approvedAt: release.approvedAt.toISOString(),
    approvedByMemberId: release.approvedByMemberId,
  };
}

function toInstallation(
  row: typeof deviceStandardInstallations.$inferSelect,
): DeviceStandardInstallation {
  return {
    deviceId: row.deviceId,
    standardId: row.standardId,
    releaseId: row.releaseId,
    installedReleaseId: row.installedReleaseId,
    state: row.state as DeviceStandardInstallation["state"],
    observedAt: row.observedAt.toISOString(),
    activeSessionIds: row.activeSessionIds as string[],
    failure: row.failure as DeviceStandardInstallation["failure"],
    serverReceivedAt: row.serverReceivedAt.toISOString(),
  };
}

export class CandidateStore {
  private readonly client;
  private readonly database;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl);
    this.database = drizzle(this.client);
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  private async resolveCitations(
    organizationId: string,
    input: CandidateSubmissionRequest,
  ): Promise<EvidenceCitation[]> {
    const citationIds = new Set<string>();
    for (const citation of input.citations) {
      if (citationIds.has(citation.id)) {
        throw new CandidateError(
          "CANDIDATE_CITATION_INVALID",
          "Candidate citation identifiers must be unique.",
        );
      }
      citationIds.add(citation.id);
    }
    const resolved: EvidenceCitation[] = [];
    for (const citation of input.citations) {
      const [target] = await this.database
        .select({
          seeded: executionSessions.isSeeded,
          evidence: executionTimelineEvents.evidence,
        })
        .from(executionSessions)
        .innerJoin(
          executionTurns,
          and(
            eq(executionTurns.sessionId, executionSessions.id),
            eq(executionTurns.canonicalTurnId, citation.turnId),
          ),
        )
        .innerJoin(
          executionTimelineEvents,
          and(
            eq(executionTimelineEvents.sessionId, executionSessions.id),
            eq(executionTimelineEvents.sourceEventId, citation.activityId),
            eq(executionTimelineEvents.turnId, citation.turnId),
          ),
        )
        .where(
          and(
            eq(executionSessions.organizationId, organizationId),
            eq(executionSessions.canonicalSessionId, citation.sessionId),
          ),
        )
        .limit(1);
      if (!target) {
        throw new CandidateError(
          "CANDIDATE_CITATION_INVALID",
          `Evidence citation ${citation.id} does not resolve in the authorized Organization.`,
        );
      }
      const sessionId = encodeURIComponent(citation.sessionId);
      const turnId = encodeURIComponent(citation.turnId);
      const activityId = encodeURIComponent(citation.activityId);
      resolved.push({
        id: citation.id,
        sessionId: citation.sessionId,
        turnId: citation.turnId,
        activityId: citation.activityId,
        synthetic: target.seeded ? "seeded" : "real",
        evidence: target.evidence as EvidenceCitation["evidence"],
        links: {
          session: `/api/v1/sessions/${sessionId}`,
          turn: `/api/v1/sessions/${sessionId}/turns/${turnId}`,
          activity: `/api/v1/sessions/${sessionId}/activity/${activityId}`,
          browser: `/?session=${sessionId}&turn=${turnId}&activity=${activityId}${target.seeded ? "&includeSeeded=true" : ""}`,
        },
      });
    }

    validateClaimsAgainstCitations(input.claims, resolved);
    return resolved;
  }

  async submit(
    organizationId: string,
    memberId: string,
    analysisCredentialId: string,
    input: CandidateSubmissionRequest,
  ): Promise<CandidateSubmissionResponse> {
    const candidatePackage = validateInstallablePackage(input.name, input.package);
    const calculatedHash = hashCandidatePackage(candidatePackage);
    if (calculatedHash !== input.artifactHash) {
      throw new CandidateError(
        "CANDIDATE_ARTIFACT_HASH_MISMATCH",
        "The submitted artifact hash does not match the canonical package bytes.",
      );
    }
    const citations = await this.resolveCitations(organizationId, input);

    return this.database.transaction(async (transaction) => {
      let [candidate] = await transaction
        .select()
        .from(candidateSkills)
        .where(
          and(
            eq(candidateSkills.organizationId, organizationId),
            eq(candidateSkills.name, input.name),
          ),
        )
        .limit(1);
      if (!candidate) {
        [candidate] = await transaction
          .insert(candidateSkills)
          .values({ organizationId, name: input.name })
          .returning();
      }
      const [existingVersion] = await transaction
        .select({ id: candidateSkillVersions.id })
        .from(candidateSkillVersions)
        .where(
          and(
            eq(candidateSkillVersions.candidateId, candidate!.id),
            eq(candidateSkillVersions.version, input.version),
          ),
        )
        .limit(1);
      if (existingVersion) {
        throw new CandidateError(
          "CANDIDATE_VERSION_EXISTS",
          "That immutable Candidate version already exists; submit a new version instead.",
        );
      }
      const [version] = await transaction
        .insert(candidateSkillVersions)
        .values({
          candidateId: candidate!.id,
          organizationId,
          version: input.version,
          artifactHash: input.artifactHash,
          artifact: candidatePackage,
          reviewerContext: input.reviewerContext,
          uncertainty: input.uncertainty,
          claims: input.claims,
          citations,
          submittedByMemberId: memberId,
          analysisCredentialId,
        })
        .returning();
      return toResponse(candidate!, version!);
    });
  }

  async list(organizationId: string): Promise<CandidateSubmissionResponse[]> {
    const rows = await this.database
      .select({
        candidate: candidateSkills,
        version: candidateSkillVersions,
        review: candidateVersionReviews,
      })
      .from(candidateSkillVersions)
      .innerJoin(
        candidateSkills,
        eq(candidateSkillVersions.candidateId, candidateSkills.id),
      )
      .leftJoin(
        candidateVersionReviews,
        eq(candidateVersionReviews.candidateVersionId, candidateSkillVersions.id),
      )
      .where(eq(candidateSkillVersions.organizationId, organizationId))
      .orderBy(asc(candidateSkillVersions.submittedAt));
    return rows.map((row) =>
      toResponse(row.candidate, row.version, row.review ?? undefined),
    );
  }

  private async candidateVersion(
    organizationId: string,
    candidateId: string,
    versionId: string,
  ) {
    const [row] = await this.database
      .select({
        candidate: candidateSkills,
        version: candidateSkillVersions,
        review: candidateVersionReviews,
      })
      .from(candidateSkillVersions)
      .innerJoin(candidateSkills, eq(candidateSkillVersions.candidateId, candidateSkills.id))
      .leftJoin(
        candidateVersionReviews,
        eq(candidateVersionReviews.candidateVersionId, candidateSkillVersions.id),
      )
      .where(
        and(
          eq(candidateSkillVersions.organizationId, organizationId),
          eq(candidateSkillVersions.candidateId, candidateId),
          eq(candidateSkillVersions.id, versionId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new CandidateError(
        "CANDIDATE_NOT_FOUND",
        "The Candidate version was not found in the authenticated Organization.",
      );
    }
    return row;
  }

  async edit(
    organizationId: string,
    memberId: string,
    candidateId: string,
    versionId: string,
    input: CandidateReviewEditRequest,
  ): Promise<CandidateSubmissionResponse> {
    const current = await this.candidateVersion(
      organizationId,
      candidateId,
      versionId,
    );
    const candidatePackage = validateInstallablePackage(
      current.candidate.name,
      input.package,
    );
    if (hashCandidatePackage(candidatePackage) !== input.artifactHash) {
      throw new CandidateError(
        "CANDIDATE_ARTIFACT_HASH_MISMATCH",
        "The edited artifact hash does not match the canonical package bytes.",
      );
    }
    const citations = current.version.citations as EvidenceCitation[];
    validateClaimsAgainstCitations(input.claims, citations);
    const [existing] = await this.database
      .select({ id: candidateSkillVersions.id })
      .from(candidateSkillVersions)
      .where(
        and(
          eq(candidateSkillVersions.candidateId, candidateId),
          eq(candidateSkillVersions.version, input.version),
        ),
      )
      .limit(1);
    if (existing) {
      throw new CandidateError(
        "CANDIDATE_VERSION_EXISTS",
        "That immutable Candidate version already exists; choose a new version.",
      );
    }
    const [created] = await this.database
      .insert(candidateSkillVersions)
      .values({
        candidateId,
        organizationId,
        version: input.version,
        artifactHash: input.artifactHash,
        artifact: candidatePackage,
        reviewerContext: input.reviewerContext,
        uncertainty: input.uncertainty,
        claims: input.claims,
        citations,
        submittedByMemberId: memberId,
        analysisCredentialId: null,
      })
      .returning();
    return toResponse(current.candidate, created!);
  }

  async reject(
    organizationId: string,
    memberId: string,
    candidateId: string,
    versionId: string,
    note: string,
  ): Promise<CandidateSubmissionResponse> {
    const row = await this.candidateVersion(organizationId, candidateId, versionId);
    if (row.review) {
      throw new CandidateError(
        "CANDIDATE_REVIEW_ALREADY_DECIDED",
        "This immutable Candidate version already has a final review decision.",
      );
    }
    const [review] = await this.database
      .insert(candidateVersionReviews)
      .values({
        candidateVersionId: versionId,
        organizationId,
        state: "rejected",
        artifactHash: row.version.artifactHash,
        note,
        decidedByMemberId: memberId,
      })
      .returning();
    return toResponse(row.candidate, row.version, review!);
  }

  async approve(
    organizationId: string,
    memberId: string,
    candidateId: string,
    versionId: string,
    artifactHash: string,
  ): Promise<OrganizationStandardRelease> {
    const row = await this.candidateVersion(organizationId, candidateId, versionId);
    if (row.version.artifactHash !== artifactHash) {
      throw new CandidateError(
        "CANDIDATE_APPROVAL_HASH_MISMATCH",
        "Approval must name the exact hash of the immutable Candidate artifact.",
      );
    }
    if (row.review) {
      throw new CandidateError(
        "CANDIDATE_REVIEW_ALREADY_DECIDED",
        "This immutable Candidate version already has a final review decision.",
      );
    }
    return this.database.transaction(async (transaction) => {
      let [standard] = await transaction
        .select()
        .from(organizationStandards)
        .where(
          and(
            eq(organizationStandards.organizationId, organizationId),
            eq(organizationStandards.candidateId, candidateId),
          ),
        )
        .limit(1);
      if (!standard) {
        [standard] = await transaction
          .insert(organizationStandards)
          .values({ organizationId, candidateId, name: row.candidate.name })
          .returning();
      }
      const [release] = await transaction
        .insert(organizationStandardReleases)
        .values({
          organizationId,
          standardId: standard!.id,
          candidateId,
          candidateVersionId: versionId,
          version: row.version.version,
          artifactHash,
          artifact: row.version.artifact,
          approvedByMemberId: memberId,
        })
        .returning();
      [standard] = await transaction
        .update(organizationStandards)
        .set({
          previousReleaseId: standard!.targetReleaseId,
          targetReleaseId: release!.id,
          distributionState: "active",
          manifestSequence: standard!.manifestSequence + 1,
          updatedAt: new Date(),
        })
        .where(eq(organizationStandards.id, standard!.id))
        .returning();
      await transaction.insert(candidateVersionReviews).values({
        candidateVersionId: versionId,
        organizationId,
        state: "approved",
        artifactHash,
        decidedByMemberId: memberId,
      });
      return toRelease(standard!, release!);
    });
  }

  async deviceManifest(organizationId: string): Promise<DeviceStandardManifest> {
    const standards = await this.database
      .select()
      .from(organizationStandards)
      .where(eq(organizationStandards.organizationId, organizationId))
      .orderBy(asc(organizationStandards.createdAt));
    const targets = await Promise.all(
      standards.map(async (standard) => {
        if (!standard.targetReleaseId) {
          throw new CandidateError(
            "STANDARD_RELEASE_NOT_FOUND",
            "The approved Organization standard has no target release.",
          );
        }
        const [release] = await this.database
          .select()
          .from(organizationStandardReleases)
          .where(
            and(
              eq(organizationStandardReleases.organizationId, organizationId),
              eq(organizationStandardReleases.standardId, standard.id),
              eq(organizationStandardReleases.id, standard.targetReleaseId),
            ),
          )
          .limit(1);
        if (!release) {
          throw new CandidateError(
            "STANDARD_RELEASE_NOT_FOUND",
            "The approved target release is unavailable.",
          );
        }
        return {
          standardId: standard.id,
          name: standard.name,
          releaseId: release.id,
          version: release.version,
          artifactHash: release.artifactHash,
          artifactUrl: `/api/v1/device/standards/artifacts/${release.id}`,
          collisionPolicy: "organization_wins_preserve_personal" as const,
          sequence: standard.manifestSequence,
          state: standard.distributionState as "active" | "paused",
          mandatory: true as const,
          previousReleaseId: standard.previousReleaseId,
        };
      }),
    );
    return {
      schemaVersion: "1",
      pollAfterSeconds: 30,
      generatedAt: new Date().toISOString(),
      targets,
    };
  }

  async artifact(
    organizationId: string,
    releaseId: string,
  ): Promise<DeviceStandardArtifact | undefined> {
    const [row] = await this.database
      .select({ standard: organizationStandards, release: organizationStandardReleases })
      .from(organizationStandardReleases)
      .innerJoin(
        organizationStandards,
        eq(organizationStandardReleases.standardId, organizationStandards.id),
      )
      .where(
        and(
          eq(organizationStandardReleases.organizationId, organizationId),
          eq(organizationStandardReleases.id, releaseId),
        ),
      )
      .limit(1);
    return row
      ? {
          standardId: row.standard.id,
          releaseId: row.release.id,
          name: row.standard.name,
          version: row.release.version,
          artifactHash: row.release.artifactHash,
          package: row.release.artifact as CandidatePackage,
        }
      : undefined;
  }

  async reportInstallation(
    organizationId: string,
    deviceId: string,
    input: DeviceStandardInstallationReportRequest,
  ): Promise<DeviceStandardInstallation> {
    const [standard] = await this.database
      .select({ id: organizationStandards.id })
      .from(organizationStandards)
      .where(
        and(
          eq(organizationStandards.organizationId, organizationId),
          eq(organizationStandards.id, input.standardId),
        ),
      )
      .limit(1);
    if (!standard) {
      throw new CandidateError("STANDARD_NOT_FOUND", "Organization standard not found.");
    }
    for (const releaseId of [input.releaseId, input.installedReleaseId]) {
      if (!releaseId) continue;
      const release = await this.artifact(organizationId, releaseId);
      if (!release || release.standardId !== input.standardId) {
        throw new CandidateError(
          "STANDARD_RELEASE_NOT_FOUND",
          "Installation status may reference only a release of its Organization standard.",
        );
      }
    }
    const [created] = await this.database
      .insert(deviceStandardInstallations)
      .values({
        deviceId,
        organizationId,
        standardId: input.standardId,
        releaseId: input.releaseId,
        installedReleaseId: input.installedReleaseId,
        state: input.state,
        observedAt: new Date(input.observedAt),
        activeSessionIds: input.activeSessionIds,
        failure: input.failure ?? null,
      })
      .returning();
    return toInstallation(created!);
  }

  async deviceInstallations(deviceId: string): Promise<DeviceStandardInstallation[]> {
    const rows = await this.database
      .select()
      .from(deviceStandardInstallations)
      .where(eq(deviceStandardInstallations.deviceId, deviceId))
      .orderBy(desc(deviceStandardInstallations.serverReceivedAt));
    return rows.map(toInstallation);
  }

  async setDistribution(
    organizationId: string,
    standardId: string,
    state: "active" | "paused",
  ): Promise<void> {
    const [standard] = await this.database
      .select()
      .from(organizationStandards)
      .where(
        and(
          eq(organizationStandards.organizationId, organizationId),
          eq(organizationStandards.id, standardId),
        ),
      )
      .limit(1);
    if (!standard) {
      throw new CandidateError("STANDARD_NOT_FOUND", "Organization standard not found.");
    }
    await this.database
      .update(organizationStandards)
      .set({
        distributionState: state,
        manifestSequence: standard.manifestSequence + 1,
        updatedAt: new Date(),
      })
      .where(eq(organizationStandards.id, standard.id));
  }

  async rollback(
    organizationId: string,
    standardId: string,
    releaseId: string,
  ): Promise<void> {
    const [standard] = await this.database
      .select()
      .from(organizationStandards)
      .where(
        and(
          eq(organizationStandards.organizationId, organizationId),
          eq(organizationStandards.id, standardId),
        ),
      )
      .limit(1);
    const [release] = await this.database
      .select()
      .from(organizationStandardReleases)
      .where(
        and(
          eq(organizationStandardReleases.organizationId, organizationId),
          eq(organizationStandardReleases.standardId, standardId),
          eq(organizationStandardReleases.id, releaseId),
        ),
      )
      .limit(1);
    if (!standard || !release) {
      throw new CandidateError(
        "STANDARD_RELEASE_NOT_FOUND",
        "Rollback requires an earlier approved release of this standard.",
      );
    }
    await this.database
      .update(organizationStandards)
      .set({
        previousReleaseId: standard.targetReleaseId,
        targetReleaseId: releaseId,
        distributionState: "active",
        manifestSequence: standard.manifestSequence + 1,
        updatedAt: new Date(),
      })
      .where(eq(organizationStandards.id, standardId));
  }

  async standards(organizationId: string): Promise<OrganizationStandardDistribution[]> {
    const standards = await this.database
      .select()
      .from(organizationStandards)
      .where(eq(organizationStandards.organizationId, organizationId))
      .orderBy(asc(organizationStandards.createdAt));
    return Promise.all(
      standards.map(async (standard) => {
        const releases = await this.database
          .select()
          .from(organizationStandardReleases)
          .where(eq(organizationStandardReleases.standardId, standard.id))
          .orderBy(asc(organizationStandardReleases.approvedAt));
        const installations = await this.database
          .select()
          .from(deviceStandardInstallations)
          .where(eq(deviceStandardInstallations.standardId, standard.id))
          .orderBy(desc(deviceStandardInstallations.serverReceivedAt));
        const target = releases.find((release) => release.id === standard.targetReleaseId);
        return {
          standardId: standard.id,
          name: standard.name,
          state: standard.distributionState as "active" | "paused",
          sequence: standard.manifestSequence,
          target: target ? toRelease(standard, target) : null,
          previousReleaseId: standard.previousReleaseId,
          releases: releases.map((release) => toRelease(standard, release)),
          installations: installations.map(toInstallation),
        };
      }),
    );
  }
}
