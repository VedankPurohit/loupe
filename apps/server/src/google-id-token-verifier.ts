import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

import { OAuth2Client } from "google-auth-library";

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type GoogleIdTokenVerifier = {
  verifyCredential(
    credential: string,
    expectedNonce: string,
  ): Promise<VerifiedGoogleIdentity>;
};

export type GoogleIdTokenErrorCode =
  | "GOOGLE_ID_TOKEN_SIGNATURE_INVALID"
  | "GOOGLE_ID_TOKEN_ISSUER_INVALID"
  | "GOOGLE_ID_TOKEN_AUDIENCE_INVALID"
  | "GOOGLE_ID_TOKEN_EXPIRED"
  | "GOOGLE_ID_TOKEN_NONCE_INVALID"
  | "GOOGLE_ID_TOKEN_CLAIMS_INVALID"
  | "GOOGLE_ID_TOKEN_VERIFICATION_UNAVAILABLE";

export class GoogleIdTokenError extends Error {
  constructor(
    public readonly code: GoogleIdTokenErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type GoogleJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

export type GoogleJwks = { keys: GoogleJwk[] };

type GoogleClaims = {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  exp?: unknown;
  nonce?: unknown;
  email?: unknown;
  name?: unknown;
  picture?: unknown;
};

function verifiedIdentity(claims: GoogleClaims): VerifiedGoogleIdentity {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw invalid(
      "GOOGLE_ID_TOKEN_CLAIMS_INVALID",
      "The Google credential identity claims are invalid.",
    );
  }
  const email = typeof claims.email === "string" ? claims.email : null;
  const displayName =
    typeof claims.name === "string" && claims.name.trim().length > 0
      ? claims.name.trim()
      : email ?? "Google Person";
  return {
    subject: claims.sub,
    email,
    displayName,
    avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
  };
}

function invalid(
  code: GoogleIdTokenErrorCode,
  message: string,
): GoogleIdTokenError {
  return new GoogleIdTokenError(code, message);
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw invalid(
      "GOOGLE_ID_TOKEN_SIGNATURE_INVALID",
      "The Google credential signature could not be verified.",
    );
  }
}

export class GoogleJwksIdTokenVerifier implements GoogleIdTokenVerifier {
  private readonly audiences: Set<string>;
  private readonly clock: () => Date;
  private readonly loadJwks: () => Promise<GoogleJwks>;

  constructor(options: {
    allowedAudiences: string[];
    clock?: () => Date;
    loadJwks?: () => Promise<GoogleJwks>;
  }) {
    if (options.allowedAudiences.length === 0) {
      throw new Error("At least one Google Web client audience is required.");
    }
    this.audiences = new Set(options.allowedAudiences);
    this.clock = options.clock ?? (() => new Date());
    this.loadJwks =
      options.loadJwks ??
      (async () => {
        const response = await fetch(
          "https://www.googleapis.com/oauth2/v3/certs",
          { headers: { accept: "application/json" } },
        );
        if (!response.ok) {
          throw invalid(
            "GOOGLE_ID_TOKEN_VERIFICATION_UNAVAILABLE",
            "Google credential verification is temporarily unavailable.",
          );
        }
        return (await response.json()) as GoogleJwks;
      });
  }

  async verifyCredential(
    credential: string,
    expectedNonce: string,
  ): Promise<VerifiedGoogleIdentity> {
    const segments = credential.split(".");
    if (segments.length !== 3) {
      throw invalid(
        "GOOGLE_ID_TOKEN_SIGNATURE_INVALID",
        "The Google credential signature could not be verified.",
      );
    }
    const [encodedHeader, encodedClaims, encodedSignature] = segments as [
      string,
      string,
      string,
    ];
    const header = decodeJson(encodedHeader) as {
      alg?: unknown;
      kid?: unknown;
    };
    if (
      typeof header !== "object" ||
      header === null ||
      header.alg !== "RS256" ||
      typeof header.kid !== "string"
    ) {
      throw invalid(
        "GOOGLE_ID_TOKEN_SIGNATURE_INVALID",
        "The Google credential signature could not be verified.",
      );
    }

    let jwks: GoogleJwks;
    try {
      jwks = await this.loadJwks();
    } catch (error) {
      if (error instanceof GoogleIdTokenError) throw error;
      throw invalid(
        "GOOGLE_ID_TOKEN_VERIFICATION_UNAVAILABLE",
        "Google credential verification is temporarily unavailable.",
      );
    }
    const jwk = jwks.keys.find(
      (candidate) =>
        candidate.kid === header.kid &&
        (candidate.alg === undefined || candidate.alg === "RS256") &&
        (candidate.use === undefined || candidate.use === "sig"),
    );
    if (!jwk) {
      throw invalid(
        "GOOGLE_ID_TOKEN_SIGNATURE_INVALID",
        "The Google credential signature could not be verified.",
      );
    }

    let signatureValid = false;
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      signatureValid = verify(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        key,
        Buffer.from(encodedSignature, "base64url"),
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      throw invalid(
        "GOOGLE_ID_TOKEN_SIGNATURE_INVALID",
        "The Google credential signature could not be verified.",
      );
    }

    const decodedClaims = decodeJson(encodedClaims);
    if (
      typeof decodedClaims !== "object" ||
      decodedClaims === null ||
      Array.isArray(decodedClaims)
    ) {
      throw invalid(
        "GOOGLE_ID_TOKEN_CLAIMS_INVALID",
        "The Google credential identity claims are invalid.",
      );
    }
    const claims = decodedClaims as GoogleClaims;
    if (
      claims.iss !== "accounts.google.com" &&
      claims.iss !== "https://accounts.google.com"
    ) {
      throw invalid(
        "GOOGLE_ID_TOKEN_ISSUER_INVALID",
        "The Google credential issuer is not allowed.",
      );
    }

    const audiences = Array.isArray(claims.aud)
      ? claims.aud.filter((value): value is string => typeof value === "string")
      : typeof claims.aud === "string"
        ? [claims.aud]
        : [];
    const acceptedAudiences = audiences.filter((audience) =>
      this.audiences.has(audience),
    );
    if (
      audiences.length === 0 ||
      acceptedAudiences.length === 0 ||
      (audiences.length > 1 &&
        (typeof claims.azp !== "string" || !this.audiences.has(claims.azp)))
    ) {
      throw invalid(
        "GOOGLE_ID_TOKEN_AUDIENCE_INVALID",
        "The Google credential audience is not allowed.",
      );
    }

    if (
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Math.floor(this.clock().getTime() / 1_000)
    ) {
      throw invalid(
        "GOOGLE_ID_TOKEN_EXPIRED",
        "The Google credential has expired.",
      );
    }
    if (claims.nonce !== expectedNonce) {
      throw invalid(
        "GOOGLE_ID_TOKEN_NONCE_INVALID",
        "The Google credential nonce is invalid or has already been used.",
      );
    }
    return verifiedIdentity(claims);
  }
}

/** Production adapter. Google's maintained client owns rotating-key retrieval/cache. */
export class GoogleLibraryIdTokenVerifier implements GoogleIdTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly allowedAudiences: string[]) {
    if (allowedAudiences.length === 0) {
      throw new Error("At least one Google Web client audience is required.");
    }
  }

  async verifyCredential(
    credential: string,
    expectedNonce: string,
  ): Promise<VerifiedGoogleIdentity> {
    let ticket;
    try {
      ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience: this.allowedAudiences,
      });
    } catch {
      throw invalid(
        "GOOGLE_ID_TOKEN_SIGNATURE_INVALID",
        "The Google credential signature could not be verified.",
      );
    }
    const payload = ticket.getPayload();
    if (!payload) {
      throw invalid(
        "GOOGLE_ID_TOKEN_CLAIMS_INVALID",
        "The Google credential identity claims are invalid.",
      );
    }
    if (payload.nonce !== expectedNonce) {
      throw invalid(
        "GOOGLE_ID_TOKEN_NONCE_INVALID",
        "The Google credential nonce is invalid or has already been used.",
      );
    }
    return verifiedIdentity(payload);
  }
}
