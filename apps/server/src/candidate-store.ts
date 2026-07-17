import { createHash } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type {
  CandidatePackage,
  CandidateSubmissionRequest,
  CandidateSubmissionResponse,
  EvidenceCitation,
} from "@workspace/contracts";
import {
  candidateSkills,
  candidateSkillVersions,
  executionSessions,
  executionTimelineEvents,
  executionTurns,
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
      | "CANDIDATE_VERSION_EXISTS",
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

function toResponse(
  candidate: typeof candidateSkills.$inferSelect,
  version: typeof candidateSkillVersions.$inferSelect,
): CandidateSubmissionResponse {
  return {
    candidate: {
      id: candidate.id,
      name: candidate.name,
      status: "pending_review",
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
    },
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
    for (const claim of input.claims) {
      if (
        claim.citationIds.length === 0 ||
        claim.citationIds.some((citationId) => !citationIds.has(citationId))
      ) {
        throw new CandidateError(
          "CANDIDATE_CLAIMS_UNCITED",
          "Every factual Candidate claim must reference at least one submitted Evidence citation.",
        );
      }
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

    const byId = new Map(resolved.map((citation) => [citation.id, citation]));
    for (const claim of input.claims) {
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
    return resolved;
  }

  async submit(
    organizationId: string,
    memberId: string,
    analysisCredentialId: string,
    input: CandidateSubmissionRequest,
  ): Promise<CandidateSubmissionResponse> {
    const candidatePackage = validateInstallablePackage(input.name, input.package);
    for (const claim of input.claims) {
      if (claim.citationIds.length === 0) {
        throw new CandidateError(
          "CANDIDATE_CLAIMS_UNCITED",
          "Every factual Candidate claim must reference at least one submitted Evidence citation.",
        );
      }
    }
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
      .select({ candidate: candidateSkills, version: candidateSkillVersions })
      .from(candidateSkillVersions)
      .innerJoin(
        candidateSkills,
        eq(candidateSkillVersions.candidateId, candidateSkills.id),
      )
      .where(eq(candidateSkillVersions.organizationId, organizationId))
      .orderBy(asc(candidateSkillVersions.submittedAt));
    return rows.map((row) => toResponse(row.candidate, row.version));
  }
}
