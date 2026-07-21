import { createPrivateKey, sign } from "node:crypto";

export const googleFixtureKeyId = "loupe-playwright-google-key";
export const googleFixturePublicJwk = {
  kty: "RSA",
  n: "kAVUUtNW7ew3S1ntNpDl2cnyKmRtbALSnfcQZNjcJ9rt5tBQpd-02QHRVg_NWKmquDQsWxBMn-OdovYqCYE-ifyrw1aOiTelXz7n6ZnYwqmDKaVdj9rdxIy0eIwUOBMAOVTx_HWWT1D7cIjjetkvkFlDrgCwMiDkzxuC3dDiuTwiTSiBVwsn1HxM-vopVhe-5m4Ai3LbpobWGuCkZoUIlTWdRvEJNGwe4F98T4TVBkkkECabmVxMFn00_ZPC1kQEChhD_9GdibLU8jhDFC55sEIEhFoAiH-2ZmZZqVP23QY3VvP9imi6wzxnVWrVgxZuvR0JA4Br529Boot2RMVkqQ",
  e: "AQAB",
  kid: googleFixtureKeyId,
  alg: "RS256",
  use: "sig",
} as const;

const googleFixturePrivateJwk = {
  ...googleFixturePublicJwk,
  d: "DHi9rN96zWcxgZ-ztFA3a1T62NNyC1KyQPYqcAU8iWICzIRZG4gkDc_DvD9pkaY9r65q8ebXL9hi6AAHs2ODEil0iVmnRbgxJK6aoCbPt8m8n0Bf-gtivXjOzwqYXKO-lvhlbS6UmeFCKORdyJ9iqE4ml3ydRXYGQm4YNtO2MoKikAPHxCtWVhUFIfxhKGddazwSLFxy3Z2jDoe-XlnSiLqsZ2Ko8Su8H-8gObcd3lb_ZNZzP5zrbWrxMq2-oUMKmGGXfexHa3JMxvpL2IH8qyW-XYVmpt6sKJDxLb2FTMpa7p31bSW2oBRMTpQqvNXmA-nJDDqP7TglRhUFggewAQ",
  p: "yB-ttnfSc1QaMiZZO45Eyj-9rJ-IRLoWmOTItk2IvpqFhOJb3KP5g-QT8R_C5GbG91kYhiTWion3V5oJEglInN5-uAebsNbDtEEHzBgBnbO9vCcGJPc4UUluj4ejx4oJvJ13AgXc343nWJ8_VrGR1YmE-4JHteuZjIp0jLLH2AE",
  q: "uDuPfAOQDoebZMvgiT6JUDdW--hHl6GR8DoJxUsDWoU0o7qz2vuGxEY_91zwxQoPWkU7TQOngaNUubyWe9fsoBEC6fDBbbte5UWumFnzip3T0axPqoXRbLP_KjzP0KxZiep96qGZ1rq7VYOvDOAJYYkJq6_nS4Eo8Yo-sZa3zKk",
  dp: "AgJfah-V21aS1MIRz0lEY4t0ShFn-tirdWmGol3w64j9ojHrnjF_RdW6ZYdeG5D0mnMojeA8zzNHane_c5DoS7roJszcwU_Gsz6b526uRXkShJsXsrNQu3AzTfmcqVo3cs9Z7IlGiHASTI98wVATGMPCtAvA0JDG_-Q7-1WoMAE",
  dq: "cx8EsgGn6uxh9cJQNHKXa0CpYg_rbJzRjMM3h8kv90h1dDoeWSADPnKHVhMFgJqgrU_FloJKEX_2WXm2rvxmKD95CqYeuGr1CV9Zkmni_SNSURrTTUMBcmOndsU5NrP732pf9FW2w687kFwQ7oKwWfo_yMDKTywOYaB5PI9pmsE",
  qi: "fXzq4I7Qs_2pqls0mwE9GYEgUXQZfjHczkrFSWVxnyOD3puyvLFEHF5scRWTZePO3pHTyAF8Bhbn7q-NlePI8p3hTiFqD7E8YYd7hAHUb2OEKsAh82dDLRtny4btmkvLZsU1roFPYJOs91j5yJcFU4gUpsorC0Bepq-nt8Ld4EY",
};

export function signedGoogleFixture(input: {
  nonce: string;
  subject?: string;
}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: googleFixtureKeyId, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "loupe-playwright.apps.googleusercontent.com",
      sub: input.subject ?? "playwright-google-subject",
      email: "playwright@example.test",
      name: "Playwright Google Person",
      nonce: input.nonce,
      iat: Math.floor(Date.now() / 1_000) - 10,
      exp: Math.floor(Date.now() / 1_000) + 300,
    }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    createPrivateKey({ key: googleFixturePrivateJwk, format: "jwk" }),
  );
  return `${signingInput}.${signature.toString("base64url")}`;
}
