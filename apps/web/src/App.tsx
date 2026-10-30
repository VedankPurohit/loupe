import { type FormEvent, useEffect, useRef, useState } from "react";

import type {
  AuthenticatedSessionResponse,
  CapturePolicy,
  EnrolledDevice,
  ExamplePackImportResponse,
  GoogleBrowserSessionResponse,
  InviteCodeResponse,
  PersonBrowserSessionResponse,
  PersonMembershipsResponse,
} from "@workspace/contracts";

import { SessionInspector } from "./SessionInspector.js";
import { CandidateStandards } from "./CandidateStandards.js";
import { DeviceDiagnostics } from "./DeviceDiagnostics.js";
import {
  GoogleSignIn,
  revokeGoogleIdentitySharing,
} from "./GoogleSignIn.js";

type View =
  | { kind: "loading" }
  | { kind: "bootstrap" }
  | { kind: "established" }
  | { kind: "home" }
  | { kind: "revoked" }
  | { kind: "session"; session: AuthenticatedSessionResponse }
  | {
      kind: "person";
      session: PersonBrowserSessionResponse & {
        googleProfile?: GoogleBrowserSessionResponse["googleProfile"];
      };
    }
  | { kind: "error"; message: string };

type RetryNotice = {
  message: string;
  retryLabel: string;
  retry: () => void | Promise<void>;
};

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("The server could not be reached.");
  }
  const body = await readJson(response);
  if (!response.ok) {
    const error = body as { error?: { message?: string } } | undefined;
    throw new Error(error?.error?.message ?? `The server rejected the request (${response.status}).`);
  }
  return body as T;
}

function operationFailure(operation: string, cause: unknown) {
  console.error(`${operation} failed:`, cause);
  const reason =
    cause instanceof Error && !(cause instanceof TypeError) && cause.message.trim().length > 0
      ? cause.message.trim().replace(/([^.!?])$/, "$1.")
      : "The server could not be reached.";
  return `${operation} failed. ${reason} Check the connection and try again.`;
}

function RetryAlert({ notice }: { notice: RetryNotice }) {
  return (
    <div role="alert" className="error operation-error">
      <span>{notice.message}</span>
      <button className="secondary-button" onClick={() => void notice.retry()} type="button">
        {notice.retryLabel}
      </button>
    </div>
  );
}

function PublicHome({
  onAuthenticated,
  onInvite,
}: {
  onAuthenticated(session: GoogleBrowserSessionResponse): void;
  onInvite(): void;
}) {
  return (
    <div className="public-home">
      <header className="public-header">
        <a className="public-brand" href="/" aria-label="Loupe home">
          <span className="public-brand-mark" aria-hidden="true">◐</span>
          <span>Loupe</span>
        </a>
        <nav aria-label="Public navigation" className="public-nav">
          <a href="#how-it-works">How it works</a>
          <a href="/guide.html">Setup guidance</a>
          <a href="https://github.com/VedankPurohit/loupe" target="_blank" rel="noreferrer">
            Source repository
          </a>
          <a className="nav-sign-in" href="#sign-in">Sign in</a>
        </nav>
      </header>

      <div className="public-home-main">
        <section className="public-hero" aria-labelledby="public-home-title">
          <div className="public-hero-copy">
            <p className="public-eyebrow">Local-first observability for coding agents</p>
            <h1 id="public-home-title">See the work.<br /><em>Keep the proof.</em></h1>
            <p className="public-lede">
              Loupe follows supported Codex Sessions from capture to investigation,
              so teams can inspect what was observed and learn from evidence that stays
              inside their Organization.
            </p>
            <div className="public-actions">
              <a className="public-primary" href="#sign-in">Choose an access path <span aria-hidden="true">↓</span></a>
              <a className="public-secondary" href="/guide.html">Read setup guidance</a>
            </div>
            <p className="public-boundary">
              Capture support is versioned and bounded. When a field is not observed,
              Loupe labels the gap instead of filling it in.
            </p>
          </div>

          <div className="evidence-loop" aria-label="Loupe evidence loop">
            <div className="loop-caption"><span>Evidence ledger</span><code>LOCAL / EXPLICIT / AUDITABLE</code></div>
            <ol>
              <li className="loop-step loop-capture"><span className="loop-node" aria-hidden="true">01</span><div><strong>Capture</strong><p>Record the supported producer facts and their source.</p></div></li>
              <li className="loop-step loop-investigate"><span className="loop-node" aria-hidden="true">02</span><div><strong>Investigate</strong><p>Trace one Organization → Session → Turn without guessing.</p></div></li>
              <li className="loop-step loop-learn"><span className="loop-node" aria-hidden="true">03</span><div><strong>Learn</strong><p>Turn cited patterns into a human-approved standard.</p></div></li>
            </ol>
            <div className="loop-foot"><span className="proof-dot" aria-hidden="true" /> Every claim keeps a path back to evidence.</div>
          </div>
        </section>

        <section id="how-it-works" className="public-how" aria-labelledby="how-title">
          <div>
            <p className="public-eyebrow">A narrow promise</p>
            <h2 id="how-title">Useful context, honest edges.</h2>
          </div>
          <div className="public-how-grid">
            <article><span>Capture boundary</span><p>Codex hooks and relay observations remain separate from derived summaries.</p></article>
            <article><span>Organization boundary</span><p>People choose where they belong. Evidence and authority do not cross memberships.</p></article>
            <article><span>Evidence boundary</span><p>Observed, inferred, unavailable, and capture-failure states stay visible in the interface.</p></article>
          </div>
        </section>

        <section id="sign-in" className="public-sign-in" aria-labelledby="sign-in-title">
          <div>
            <p className="public-eyebrow">Two explicit access paths</p>
            <h2 id="sign-in-title">Enter with Google or a one-time code.</h2>
            <p>Google identifies a Person. A single-use Invite code is the self-hosted fallback and judge access path.</p>
          </div>
          <div className="public-sign-in-actions">
            <GoogleSignIn onAuthenticated={onAuthenticated} />
            <a className="invite-link" href="?onboarding=invite" onClick={(event) => { event.preventDefault(); onInvite(); }}>
              Use an Invite code →
            </a>
          </div>
        </section>
      </div>

      <footer className="public-footer">
        <span>Loupe · local-first observability</span>
        <span>Production hosting and unsupported fidelity remain outside this local milestone.</span>
      </footer>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [devices, setDevices] = useState<EnrolledDevice[]>([]);
  const [deviceError, setDeviceError] = useState<RetryNotice>();
  const [enrollmentGrant, setEnrollmentGrant] = useState<string>();
  const [inviteCode, setInviteCode] = useState<InviteCodeResponse>();
  const [inviteError, setInviteError] = useState<RetryNotice>();
  const [memberships, setMemberships] = useState<
    PersonMembershipsResponse["memberships"]
  >([]);
  const [membershipError, setMembershipError] = useState<string>();
  const [examplePackStatus, setExamplePackStatus] = useState<string>();
  const [examplePackError, setExamplePackError] = useState<RetryNotice>();
  const [logoutError, setLogoutError] = useState<RetryNotice>();
  const activeMembershipId = useRef<string | undefined>(undefined);
  const membershipNavigationGeneration = useRef(0);
  const membershipNavigationTarget = useRef<string | undefined>(undefined);

  function canonicalizeMembershipLocation(membershipId?: string) {
    window.history.replaceState(
      {},
      "",
      membershipId
        ? `?membership=${encodeURIComponent(membershipId)}`
        : window.location.pathname,
    );
  }

  async function loadDevices() {
    try {
      const body = await requestJson<{ devices: EnrolledDevice[] }>("/api/v1/devices");
      setDevices(body.devices);
      setDeviceError(undefined);
    } catch (cause) {
      setDeviceError({
        message: operationFailure("Loading enrolled devices", cause),
        retryLabel: "Try loading devices again",
        retry: loadDevices,
      });
    }
  }

  async function loadMemberships() {
    try {
      const body = await requestJson<PersonMembershipsResponse>(
        "/api/v1/person/memberships",
      );
      setMemberships(body.memberships);
      setMembershipError(undefined);
      return body.memberships;
    } catch (cause) {
      setMembershipError(operationFailure("Loading Organization memberships", cause));
      return [];
    }
  }

  async function activateMembership(
    membershipId: string,
    navigation: "push" | "replace" | "none",
    shouldCommit: () => boolean,
  ) {
    setMembershipError(undefined);
    try {
      const session = await requestJson<AuthenticatedSessionResponse>(
        "/api/v1/session/active-membership",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ membershipId }),
        },
      );
      if (!shouldCommit()) return undefined;
      activeMembershipId.current = session.member.id;
      setView({ kind: "session", session });
      const destination = `?membership=${encodeURIComponent(session.member.id)}`;
      if (navigation === "push") window.history.pushState({}, "", destination);
      if (navigation === "replace") window.history.replaceState({}, "", destination);
      await Promise.all([loadMemberships(), loadDevices()]);
      return session;
    } catch (cause) {
      if (shouldCommit()) {
        setMembershipError(operationFailure("Selecting the Organization", cause));
      }
      return undefined;
    }
  }

  async function reconcileMembership(
    membershipId: string,
    generation: number,
    navigation: "push" | "replace" | "none",
    force = false,
  ) {
    if (!force && membershipId === activeMembershipId.current) return undefined;
    const selected = await activateMembership(
      membershipId,
      navigation,
      () =>
        generation === membershipNavigationGeneration.current &&
        membershipNavigationTarget.current === membershipId,
    );
    if (
      generation !== membershipNavigationGeneration.current ||
      membershipNavigationTarget.current !== membershipId
    ) {
      const latestMembership = membershipNavigationTarget.current;
      if (latestMembership) {
        void reconcileMembership(
          latestMembership,
          membershipNavigationGeneration.current,
          "none",
          true,
        );
      } else {
        const activatedMembership = activeMembershipId.current ?? membershipId;
        membershipNavigationTarget.current = activatedMembership;
        canonicalizeMembershipLocation(activatedMembership);
        void reconcileMembership(
          activatedMembership,
          membershipNavigationGeneration.current,
          "none",
          true,
        );
      }
      return undefined;
    }
    if (!selected) {
      membershipNavigationTarget.current = activeMembershipId.current;
      canonicalizeMembershipLocation(activeMembershipId.current);
    }
    return selected;
  }

  function selectMembership(
    membershipId: string,
    navigation: "push" | "replace" | "none" = "push",
  ) {
    const generation = ++membershipNavigationGeneration.current;
    membershipNavigationTarget.current = membershipId;
    return reconcileMembership(membershipId, generation, navigation, true);
  }

  async function enterMembership(session: AuthenticatedSessionResponse) {
    ++membershipNavigationGeneration.current;
    membershipNavigationTarget.current = session.member.id;
    activeMembershipId.current = session.member.id;
    setView({ kind: "session", session });
    const updateHistory =
      memberships.length === 0
        ? window.history.replaceState.bind(window.history)
        : window.history.pushState.bind(window.history);
    updateHistory(
      {},
      "",
      `?membership=${encodeURIComponent(session.member.id)}`,
    );
    await Promise.all([loadMemberships(), loadDevices()]);
  }

  useEffect(() => {
    let cancelled = false;
    const hydrationGeneration = membershipNavigationGeneration.current;
    void (async () => {
      const sessionResponse = await fetch("/api/v1/session");
      if (
        cancelled ||
        hydrationGeneration !== membershipNavigationGeneration.current
      ) return;
      let requestedMembership = new URLSearchParams(
        window.location.search,
      ).get("membership");
      if (sessionResponse.ok) {
        const session =
          (await sessionResponse.json()) as PersonBrowserSessionResponse;
        if (!cancelled) {
          activeMembershipId.current = session.member?.id ?? undefined;
          membershipNavigationTarget.current =
            requestedMembership ?? session.member?.id ?? undefined;
          await loadMemberships();
          const currentRequestedMembership = new URLSearchParams(
            window.location.search,
          ).get("membership");
          if (
            !cancelled &&
            hydrationGeneration === membershipNavigationGeneration.current &&
            !session.member &&
            !membershipNavigationTarget.current &&
            !currentRequestedMembership
          ) {
            requestedMembership = null;
          }
          if (
            cancelled ||
            hydrationGeneration !== membershipNavigationGeneration.current ||
            membershipNavigationTarget.current !==
              (requestedMembership ?? session.member?.id ?? undefined) ||
            currentRequestedMembership !== requestedMembership
          ) return;
          if (
            requestedMembership &&
            requestedMembership !== session.member?.id
          ) {
            const selected = await reconcileMembership(
              requestedMembership,
              hydrationGeneration,
              "none",
              true,
            );
            if (
              cancelled ||
              hydrationGeneration !== membershipNavigationGeneration.current
            ) return;
            if (selected) return;
            membershipNavigationTarget.current = session.member?.id ?? undefined;
            canonicalizeMembershipLocation(session.member?.id ?? undefined);
          }
          if (session.organization && session.member) {
            setView({
              kind: "session",
              session: {
                person: session.person,
                organization: session.organization,
                member: session.member,
              },
            });
            if (!requestedMembership) {
              window.history.replaceState(
                {},
                "",
                `?membership=${encodeURIComponent(session.member.id)}`,
              );
            }
            await loadDevices();
          } else {
            setView({ kind: "person", session });
          }
        }
        return;
      }

      if (sessionResponse.status === 401 && requestedMembership) {
        if (!cancelled) setView({ kind: "revoked" });
        return;
      }

      const statusResponse = await fetch("/api/v1/bootstrap/status");
      if (!statusResponse.ok) {
        if (!cancelled) {
          setView({
            kind: "error",
            message: "The server is not ready. Check PostgreSQL and try again.",
          });
        }
        return;
      }
      const status = (await statusResponse.json()) as { required: boolean };
      if (!cancelled) {
        setView(status.required ? { kind: "bootstrap" } : { kind: "home" });
      }
    })().catch(() => {
      if (
        !cancelled &&
        hydrationGeneration === membershipNavigationGeneration.current
      ) {
        setView({
          kind: "error",
          message: "The application could not reach the server.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    activeMembershipId.current =
      view.kind === "session" ? view.session.member.id : undefined;
  }, [view]);

  useEffect(() => {
    const restoreMembership = () => {
      const membershipId = new URLSearchParams(window.location.search).get(
        "membership",
      );
      if (!membershipId) {
        if (!activeMembershipId.current) {
          membershipNavigationTarget.current = undefined;
          return;
        }
        const generation = ++membershipNavigationGeneration.current;
        membershipNavigationTarget.current = activeMembershipId.current;
        canonicalizeMembershipLocation(activeMembershipId.current);
        void reconcileMembership(
          activeMembershipId.current,
          generation,
          "none",
          true,
        );
        return;
      }
      const generation = ++membershipNavigationGeneration.current;
      membershipNavigationTarget.current = membershipId;
      void reconcileMembership(membershipId, generation, "none", true);
    };
    window.addEventListener("popstate", restoreMembership);
    return () => window.removeEventListener("popstate", restoreMembership);
  }, []);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/bootstrap/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: data.get("code"),
          organization: { name: data.get("organizationName") },
          administrator: { displayName: data.get("displayName") },
        }),
      });
      const body = await readJson(response);
      if (response.ok) {
        setView({ kind: "session", session: body as AuthenticatedSessionResponse });
        await loadDevices();
      } else {
        const error = body as { error?: { message?: string } } | undefined;
        setFormError(error?.error?.message ?? "Redeeming the Bootstrap code failed. Check the code and try again.");
      }
    } catch (cause) {
      setFormError(operationFailure("Redeeming the Bootstrap code", cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function createEnrollmentGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createEnrollmentGrantFor(String(data.get("deviceName") ?? ""));
  }

  async function createEnrollmentGrantFor(deviceName: string) {
    setDeviceError(undefined);
    setEnrollmentGrant(undefined);
    try {
      const body = await requestJson<{ grant: string }>("/api/v1/device-enrollment-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceName }),
      });
      setEnrollmentGrant(body.grant);
    } catch (cause) {
      setDeviceError({
        message: operationFailure("Creating an enrollment grant", cause),
        retryLabel: "Try creating enrollment grant",
        retry: () => createEnrollmentGrantFor(deviceName),
      });
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await createInviteFor(Number(data.get("expiresInHours")));
  }

  async function createInviteFor(expiresInHours: number) {
    setInviteError(undefined);
    setInviteCode(undefined);
    try {
      const body = await requestJson<InviteCodeResponse>("/api/v1/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInHours }),
      });
      setInviteCode(body);
    } catch (cause) {
      setInviteError({
        message: operationFailure("Creating an Invite code", cause),
        retryLabel: "Try creating Invite code",
        retry: () => createInviteFor(expiresInHours),
      });
    }
  }

  async function revokeInvite(inviteId: string) {
    try {
      await requestJson(`/api/v1/invites/${inviteId}/revoke`, {
        method: "POST",
      });
      setInviteCode(undefined);
      setInviteError(undefined);
    } catch (cause) {
      setInviteError({
        message: operationFailure("Revoking the Invite code", cause),
        retryLabel: "Try revoking Invite code",
        retry: () => revokeInvite(inviteId),
      });
    }
  }

  async function importExamplePack(version: "starter-v1" | "rich-v1") {
    setExamplePackStatus(`Importing the versioned ${version} pack…`);
    setExamplePackError(undefined);
    try {
      const result = await requestJson<ExamplePackImportResponse>(
        `/api/v1/administration/example-packs/${version}/import`,
        { method: "POST" },
      );
      setExamplePackStatus(
        `${result.imported ? "Imported" : "Already imported"} ${version}: ${result.counts.members.toLocaleString("en-US")} Example members, ${result.counts.sessions.toLocaleString("en-US")} Seeded Sessions, ${result.counts.turns.toLocaleString("en-US")} Turns, ${result.counts.agentRuns.toLocaleString("en-US")} Agent runs, and ${result.counts.detailRecords.toLocaleString("en-US")} detail records. Every record is permanently labelled Seeded/Example.`,
      );
    } catch (cause) {
      setExamplePackStatus(undefined);
      setExamplePackError({
        message: operationFailure("Importing the Example data pack", cause),
        retryLabel: `Try importing ${version}`,
        retry: () => importExamplePack(version),
      });
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMembershipError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const session = await requestJson<AuthenticatedSessionResponse>(
        "/api/v1/organizations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: data.get("organizationName") }),
        },
      );
      await enterMembership(session);
    } catch (cause) {
      setMembershipError(operationFailure("Creating the Organization", cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function redeemInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const displayName = data.get("displayName");
      const response = await fetch("/api/v1/invites/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: data.get("inviteCode"),
          ...(typeof displayName === "string" && displayName.trim().length > 0
            ? { member: { displayName } }
            : {}),
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        const error = body as { error?: { message?: string } } | undefined;
        setFormError(error?.error?.message ?? "Redeeming the Invite code failed. Check the code and try again.");
        return;
      }
      await enterMembership(body as AuthenticatedSessionResponse);
    } catch (cause) {
      setFormError(operationFailure("Redeeming the Invite code", cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function updatePolicy(
    deviceId: string,
    change: Partial<Pick<CapturePolicy, "ordinaryRedactionEnabled" | "demoCanaryEnabled">>,
  ) {
    const previousPolicy = devices.find((device) => device.id === deviceId)?.capturePolicy;
    setDevices((current) =>
      current.map((device) =>
        device.id === deviceId
          ? {
              ...device,
              capturePolicy: { ...device.capturePolicy, ...change },
            }
          : device,
      ),
    );
    try {
      const capturePolicy = await requestJson<CapturePolicy>(`/api/v1/devices/${deviceId}/capture-policy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      });
      setDevices((current) => current.map((device) =>
        device.id === deviceId ? { ...device, capturePolicy } : device,
      ));
      setDeviceError(undefined);
    } catch (cause) {
      if (previousPolicy) {
        setDevices((current) => current.map((device) =>
          device.id === deviceId ? { ...device, capturePolicy: previousPolicy } : device,
        ));
      }
      setDeviceError({
        message: operationFailure("Updating the capture policy", cause),
        retryLabel: "Try updating capture policy",
        retry: () => updatePolicy(deviceId, change),
      });
    }
  }

  async function revokeDevice(deviceId: string) {
    try {
      await requestJson(`/api/v1/devices/${deviceId}/revoke`, { method: "POST" });
      await loadDevices();
    } catch (cause) {
      setDeviceError({
        message: operationFailure("Revoking the Device credential", cause),
        retryLabel: "Try revoking Device credential",
        retry: () => revokeDevice(deviceId),
      });
    }
  }

  async function logout() {
    setFormError(undefined);
    setLogoutError(undefined);
    try {
      const response = await fetch("/api/v1/session/logout", { method: "POST" });
      if (!response.ok) {
        setLogoutError({
          message: "The browser session could not be revoked. Try again.",
          retryLabel: "Try logging out again",
          retry: logout,
        });
        return;
      }
      setDevices([]);
      setMemberships([]);
      window.history.replaceState({}, "", window.location.pathname);
      setView({ kind: "established" });
    } catch {
      setLogoutError({
        message: operationFailure("Logging out", new Error("The server could not be reached.")),
        retryLabel: "Try logging out again",
        retry: logout,
      });
    }
  }

  function googleAuthenticated(session: GoogleBrowserSessionResponse) {
    setView({ kind: "person", session });
    window.history.replaceState({}, "", window.location.pathname);
    void loadMemberships();
  }

  function openInviteOnboarding() {
    window.history.pushState({}, "", "?onboarding=invite");
    setView({ kind: "established" });
  }

  async function unlinkGoogle(session: Extract<View, { kind: "person" }>["session"]) {
    if (!session.googleProfile) return;
    setFormError(undefined);
    try {
      await revokeGoogleIdentitySharing(
        session.person.email ?? session.googleProfile.subject,
      );
      const response = await fetch("/api/v1/auth/google/link", {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Loupe could not remove the Google identity link.");
      }
      setView({
        kind: "person",
        session: {
          person: session.person,
          organization: session.organization,
          member: session.member,
        },
      });
    } catch (cause) {
      setFormError(
        operationFailure("Unlinking Google", cause),
      );
    }
  }

  return (
    <main
      className={`shell ${view.kind === "home" ? "public-shell" : ""}`}
      data-view={view.kind}
      data-visual-system="open-memory-ledger"
    >
      <header className="brand">
        <span className="brand-mark loupe-ledger-mark" aria-hidden="true"><i /><i /></span>
        <span><strong>Loupe</strong><small>Evidence for coding-agent work</small></span>
      </header>

      {view.kind === "loading" && <p className="status">Connecting to the server…</p>}

      {view.kind === "home" && (
        <PublicHome
          onAuthenticated={googleAuthenticated}
          onInvite={openInviteOnboarding}
        />
      )}

      {membershipError && <p role="alert" className="error operation-error">{membershipError}</p>}

      {view.kind === "bootstrap" && (
        <section className="card entry-card bootstrap-card" aria-labelledby="bootstrap-title">
          <header className="entry-intro">
            <p className="eyebrow">First-time setup · two access paths</p>
            <h1 id="bootstrap-title">Establish your Organization</h1>
            <p className="lede">Choose the identity path configured for this deployment. Both paths create a real Loupe browser session.</p>
          </header>
          <div className="entry-paths">
            <section className="entry-path entry-google" aria-labelledby="bootstrap-google-title">
              <span className="entry-path-code">Path A · Google identity</span>
              <h2 id="bootstrap-google-title">Use your Google account</h2>
              <p>Create your Loupe Person first, then name the Organization you administer.</p>
              <GoogleSignIn onAuthenticated={googleAuthenticated} />
            </section>
            <section className="entry-path entry-code" aria-labelledby="bootstrap-code-title">
              <span className="entry-path-code">Path B · Operator fallback</span>
              <h2 id="bootstrap-code-title">Use the server’s Bootstrap code</h2>
              <p>The API prints one expiring, single-use code. This path needs no Google account.</p>
              <form onSubmit={redeem}>
                <label>
                  Organization name
                  <input name="organizationName" autoComplete="organization" required />
                </label>
                <label>
                  Your display name
                  <input name="displayName" autoComplete="name" required />
                </label>
                <label>
                  Bootstrap code
                  <input name="code" autoComplete="off" spellCheck={false} required />
                </label>
                {formError && <p role="alert" className="error">{formError}</p>}
                <button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create Organization"}
                </button>
              </form>
            </section>
          </div>
        </section>
      )}

      {view.kind === "session" && (
        <>
          <nav className="app-nav" aria-label="Application navigation">
            <a href="#activity">Activity</a>
            <a href="#devices-title">Device diagnostics</a>
            <a href="#investigation">Investigation</a>
            {view.session.member.role === "administrator" && <a href="#standards">Standards</a>}
          </nav>
          <section className="card organization-passport" aria-labelledby="welcome-title">
            <p className="eyebrow">Organization ready</p>
            <h1 id="welcome-title">Welcome, {view.session.member.displayName}</h1>
            <div className="identity-row">
              <div>
                <span className="detail-label">Organization</span>
                <strong>{view.session.organization.name}</strong>
              </div>
              <div>
                <span className="detail-label">Role</span>
                <strong className="role">
                  {view.session.member.role === "administrator"
                    ? "Administrator"
                    : "Member"}
                </strong>
              </div>
            </div>
            <label>
              Active Organization
              <select
                aria-label="Active Organization"
                value={view.session.member.id}
                onChange={(event) =>
                  void selectMembership(event.currentTarget.value)
                }
              >
                {memberships.map((membership) => (
                  <option
                    key={membership.member.id}
                    value={membership.member.id}
                  >
                    {membership.organization.name} — {membership.member.role === "administrator" ? "Administrator" : "Member"}
                  </option>
                ))}
              </select>
            </label>
            <p className="lede">
              Your authenticated browser session is active. Manage capture for
              your enrolled Macs below.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void logout()}
            >
              Log out
            </button>
            {logoutError && <RetryAlert notice={logoutError} />}
          </section>

          <div id="activity">
            <div id="investigation">
            <SessionInspector
              key={view.session.member.id}
              member={view.session.member}
            />
            </div>
          </div>

          <div className="session-secondary">
          <DeviceDiagnostics devices={devices} />

          {view.session.member.role === "administrator" && (
            <div id="standards"><CandidateStandards /></div>
          )}

          {view.session.member.role === "administrator" && (
            <section className="card settings-card" aria-labelledby="invite-title">
              <p className="eyebrow">Members</p>
              <h2 id="invite-title">Invite an ordinary Member</h2>
              <form onSubmit={createInvite} className="grant-form">
                <label>
                  Expires in hours
                  <input
                    name="expiresInHours"
                    type="number"
                    min={1}
                    max={168}
                    defaultValue={24}
                    required
                  />
                </label>
                <button type="submit">Create Invite code</button>
              </form>
              {inviteCode && (
                <div className="grant-panel">
                  <span className="detail-label">Expiring, single-use Invite code</span>
                  <output aria-label="Invite code">{inviteCode.code}</output>
                  <p>Share it out of band. Redemption always creates a Member, never an Administrator.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void revokeInvite(inviteCode.id)}
                  >
                    Revoke Invite code
                  </button>
                </div>
              )}
              {inviteError && <RetryAlert notice={inviteError} />}
              <div className="grant-panel">
                <span className="detail-label">Explicit Example data</span>
                <p>
                  The idempotent starter-v1 pack uses a server-controlled path,
                  never a Device credential. Seeded Sessions stay excluded from
                  activity and aggregates until explicitly included.
                </p>
                <button type="button" onClick={() => void importExamplePack("starter-v1")}>
                  Import starter-v1 Example pack
                </button>
                <button type="button" onClick={() => void importExamplePack("rich-v1")}>
                  Import rich-v1 Example pack — 12 members, 480 Sessions
                </button>
                {examplePackStatus && (
                  <output role="status" aria-label="Example pack import status">
                    {examplePackStatus}
                  </output>
                )}
                {examplePackError && <RetryAlert notice={examplePackError} />}
              </div>
            </section>
          )}

          <section className="card settings-card" aria-labelledby="devices-title">
            <p className="eyebrow">Capture Settings</p>
            <h2 id="devices-title">Enrolled devices</h2>
            <form onSubmit={createEnrollmentGrant} className="grant-form">
              <label>
                Device name
                <input name="deviceName" required maxLength={120} />
              </label>
              <button type="submit">Create enrollment grant</button>
            </form>
            {enrollmentGrant && (
              <div className="grant-panel">
                <span className="detail-label">Short-lived, single-use grant</span>
                <output aria-label="Enrollment grant">{enrollmentGrant}</output>
                <p>
                  Exchange this grant during setup. It is not a browser session or
                  a Device credential.
                </p>
              </div>
            )}
            {deviceError && <RetryAlert notice={deviceError} />}
            <div className="device-list">
              {devices.map((device) => (
                <article className="device" key={device.id}>
                  <div className="device-heading">
                    <div>
                      <h3>{device.name}</h3>
                      <span className={`health health-${device.health}`}>
                        {device.health === "healthy" ? "Healthy" : "Revoked"}
                      </span>
                    </div>
                    <strong>Policy version {device.capturePolicy.version}</strong>
                  </div>
                  <p className="last-seen">
                    {device.lastSeenAt
                      ? `Last relay contact ${new Date(device.lastSeenAt).toLocaleString()}`
                      : "Awaiting first relay contact"}
                  </p>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={device.capturePolicy.ordinaryRedactionEnabled}
                      disabled={device.health === "revoked"}
                      onChange={(event) =>
                        void updatePolicy(device.id, {
                          ordinaryRedactionEnabled: event.currentTarget.checked,
                        })
                      }
                    />
                    Ordinary high-confidence redaction
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={device.capturePolicy.demoCanaryEnabled}
                      disabled={device.health === "revoked"}
                      onChange={(event) =>
                        void updatePolicy(device.id, {
                          demoCanaryEnabled: event.currentTarget.checked,
                        })
                      }
                    />
                    Demo redaction canary
                  </label>
                  {device.health !== "revoked" && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void revokeDevice(device.id)}
                    >
                      Revoke Device credential
                    </button>
                  )}
                </article>
              ))}
              {devices.length === 0 && (
                <p className="lede">No Macs are enrolled yet.</p>
              )}
            </div>
          </section>
          </div>
        </>
      )}

      {view.kind === "person" && (
        <section className="card onboarding-card" aria-labelledby="person-title">
          <p className="eyebrow">Google identity verified</p>
          <h1 id="person-title">Welcome, {view.session.person.displayName}</h1>
          <p className="lede">
            You are signed in to Loupe, but Google authentication does not grant
            Organization membership. Create an Organization, redeem an Invite,
            or select one of your existing memberships to continue.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void logout()}
          >
            Log out
          </button>
          {view.session.googleProfile && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void unlinkGoogle(view.session)}
            >
              Unlink Google
            </button>
          )}
          {formError && <p role="alert" className="error">{formError}</p>}
          {logoutError && <RetryAlert notice={logoutError} />}
        </section>
      )}

      {view.kind === "revoked" && (
        <section className="card public-state-card" role="alert" aria-labelledby="revoked-title">
          <p className="eyebrow">Session boundary</p>
          <h1 id="revoked-title">Your Loupe Session ended</h1>
          <p className="lede">
            This browser Session is no longer valid. Sign in again to choose an Organization;
            your Google account and Organization memberships are unchanged.
          </p>
          <div className="state-actions">
            <a className="public-primary" href="/#sign-in">Sign in again</a>
            <a className="public-secondary" href="/">Return to the public homepage</a>
          </div>
        </section>
      )}

      {(view.kind === "person" || view.kind === "session") && (
        <section className="card settings-card organization-access-card" aria-labelledby="organization-access-title">
          <p className="eyebrow">Organization access</p>
          <h2 id="organization-access-title">
            {memberships.length === 0
              ? "No Organization memberships yet."
              : "Create or join another Organization"}
          </h2>
          {memberships.length > 0 && (
            <ul aria-label="Your Organization memberships">
              {memberships.map((membership) => (
                <li key={membership.member.id}>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-current={
                      view.kind === "session" &&
                      membership.member.id === view.session.member.id
                        ? "page"
                        : undefined
                    }
                    onClick={() => void selectMembership(membership.member.id)}
                  >
                    {membership.organization.name} — {membership.member.role === "administrator" ? "Administrator" : "Member"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={createOrganization} className="grant-form">
            <label>
              New Organization name
              <input name="organizationName" required maxLength={120} />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Organization"}
            </button>
          </form>
          <form onSubmit={redeemInvite} className="grant-form">
            <label>
              Invite code
              <input name="inviteCode" autoComplete="off" spellCheck={false} required />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Joining…" : "Redeem Invite"}
            </button>
          </form>
          {formError && <p role="alert" className="error">{formError}</p>}
        </section>
      )}

      {view.kind === "established" && (
        <section className="card entry-card join-card" aria-labelledby="invite-redeem-title">
          <header className="entry-intro">
            <p className="eyebrow">Join an existing Organization</p>
            <h1 id="invite-redeem-title">Choose how you enter Loupe</h1>
            <p className="lede">Google is convenient. A single-use Invite code remains a complete fallback and needs no Google account.</p>
          </header>
          <div className="entry-paths">
            <section className="entry-path entry-google" aria-labelledby="join-google-title">
              <span className="entry-path-code">Path A · Google identity</span>
              <h2 id="join-google-title">Continue with Google</h2>
              <p>Sign in first, then select or join one of your Organizations.</p>
              <GoogleSignIn onAuthenticated={googleAuthenticated} />
            </section>
            <section className="entry-path entry-code" aria-labelledby="invite-redeem-code-title">
              <span className="entry-path-code">Path B · One-time Invite</span>
              <h2 id="invite-redeem-code-title">Redeem your Invite code</h2>
              <p>An Administrator issues each expiring code for one new Member.</p>
              <form onSubmit={redeemInvite}>
                <label>
                  Your display name
                  <input name="displayName" autoComplete="name" required />
                </label>
                <label>
                  Invite code
                  <input name="inviteCode" autoComplete="off" spellCheck={false} required />
                </label>
                {formError && <p role="alert" className="error">{formError}</p>}
                <button type="submit" disabled={submitting}>
                  {submitting ? "Joining…" : "Join Organization"}
                </button>
              </form>
            </section>
          </div>
        </section>
      )}

      {view.kind === "error" && (
        <section className="card" role="alert">
          <h1>Unable to start</h1>
          <p className="error">{view.message}</p>
          <button type="button" onClick={() => window.location.reload()}>Try starting Loupe again</button>
        </section>
      )}
    </main>
  );
}
