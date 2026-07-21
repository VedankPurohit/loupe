# Loupe — Coding-Agent Observability

Loupe's shared language for observing how coding agents work, how their executions relate, and how an organization learns from those executions.

## Execution

**Session**:
One durable, resumable body of coding-agent work initiated by a developer, containing an execution graph and its captured content. A session does not require a permanent end state.
_Avoid_: Conversation, chat, trace

**Activity episode**:
A contiguous period of observed work within a session, beginning with new or resumed activity and ending when the agent stops, disconnects, or becomes idle.
_Avoid_: Completed session, run, visit

**Turn**:
A user request and all resulting root-agent, subagent, model, tool, skill, MCP, and context activity before control returns. The turn is the authoritative atomic work unit for initial diagnosis and comparison.
_Avoid_: Message, prompt, session

**Turn label**:
A human-assigned classification attached to a turn by its session owner or an administrator. The term is reserved for later use; fine-grained Turn labelling is not a hackathon deliverable.
_Avoid_: Inferred work unit, automatic segment

**Session outcome**:
A lightweight human-assigned assessment of a session, initially successful, partial, failed, or unknown.
_Avoid_: Agent score, productivity score

**Review status**:
A lightweight human-assigned indication that a session is an exemplar, needs help, or is ordinary.
_Avoid_: Approval status, outcome

**Session tag**:
A free-form human-assigned label used to organize or find sessions without changing their execution structure.
_Avoid_: Work unit, inferred category

**Activity state**:
A derived indication that a session is live, idle, or resumed based on observed events and connectivity, not a permanent session outcome.
_Avoid_: Session status, completion state

**Agent run**:
One bounded execution of an agent within a session. An agent run is either the single root run or a subagent run with exactly one parent agent run.
_Avoid_: Agent, process, thread

**Root agent run**:
The agent run that begins a session and may create subagent runs.
_Avoid_: Main agent, parent agent

**Subagent run**:
An agent run created by exactly one parent agent run to perform delegated work. A subagent run may create its own subagent runs.
_Avoid_: Child process, worker

**Execution graph**:
The causal structure connecting agent runs, model requests, tool invocations, and other observed activity within a session. Its agent-run hierarchy is a rooted parent-child tree even when the wider causal structure is not.
_Avoid_: Session tree, flat timeline

## Context and capabilities

**Context item**:
An attributable piece of information supplied to a model request, such as an instruction, skill content, MCP result, tool result, memory, or prior message.
_Avoid_: Context blob

**Context provenance**:
The recorded origin and path by which a context item entered a model request.
_Avoid_: Source metadata

**Token usage**:
Provider-reported tokens consumed by model requests, separated by input, cached input, output, and reasoning when available.
_Avoid_: Context size, token estimate

**Context occupancy**:
The amount of the model's available context window occupied at a particular model request.
_Avoid_: Token usage, session tokens

**Context contribution**:
The exact or estimated token share attributable to one context item or source at a particular model request.
_Avoid_: Token usage, context occupancy

**Context baseline**:
The context occupancy and composition observed at a session's first model request, before subsequent turn history accumulates.
_Avoid_: Empty context, initial token usage

**Capability snapshot**:
The skills, tools, MCP servers, and other callable capabilities available to an agent run at a particular point.
_Avoid_: Loaded skills, tool list

**Agent adapter**:
A source-specific boundary that preserves original observations and maps supported agent activity into the shared observability model.
_Avoid_: Integration, collector, parser

**Capture capability**:
A declared class of information an agent adapter can observe reliably, observe by inference, or cannot observe.
_Avoid_: Feature support, completeness

## Organization

**Organization**:
An authenticated collaboration and visibility boundary whose members can inspect its captured sessions by default. One Loupe deployment may host multiple Organizations without sharing evidence or authority between them.
_Avoid_: Deployment, public, tenant, workspace

**Person**:
A stable authenticated human identity that may hold membership in multiple Organizations.
_Avoid_: Member, Device, browser session, account

**Organization member**:
A Person's membership in one Organization, through which they may use its browser and CLI surfaces and own captured sessions. Each Organization member is either a Member or an Administrator, independently of that Person's role in any other Organization.
_Avoid_: Person, Device, session owner, account

**Member**:
An organization member with ordinary access to organization-visible content and no authority to approve or publish Organization standards.
_Avoid_: User, viewer, non-admin

**Enrolled device**:
A machine authorized with its own revocable Device credential to deliver captured coding-agent activity for exactly one Organization member at a time and to receive mandatory approved Organization standards. One Organization member may have multiple Enrolled devices.
_Avoid_: User, session owner, listener identity

**Device credential**:
A revocable credential belonging to one Enrolled device and authorized only to deliver captured activity, inspect that device's capture policy and delivery/installation status, and read approved Organization-standard manifests and artifacts required for mandatory synchronization. It cannot browse Organization evidence or approve, publish, pause, or roll back a release.
_Avoid_: Member credential, API key, browser session

**Analysis credential**:
A revocable credential belonging to one Organization member and authorizing the Analysis CLI to read organization evidence and submit Candidate skills without approving or publishing them.
_Avoid_: Administrator credential, Device credential

**Session owner**:
The Organization member associated with the Enrolled device when a session is first accepted. The recorded owner remains part of the session's history if the device is later enrolled by a different member.
_Avoid_: User, author

**Example member**:
A synthetic Member that owns clearly labelled Seeded sessions and is never presented as a real person.
_Avoid_: Demo user, fake user, Administrator

**Seeded session**:
A synthetic example Session used for onboarding or comparison and kept distinguishable from real captured activity.
_Avoid_: Captured session, real session

**Example data pack**:
A versioned, idempotent set of Example members and Seeded sessions loaded only through an explicit Administrator CLI command or UI action and never through an Enrolled device.
_Avoid_: Automatic seed, captured data, migration fixture

**Demo redaction canary**:
A disabled-by-default capture setting that, when explicitly enabled, redacts only one exact harmless synthetic prefix to demonstrate the end-to-end redaction path without using a real secret or broad pattern.
_Avoid_: Real credential, general redaction rule, proof of complete secret detection

**Bootstrap code**:
A single-use credential that establishes the first Administrator of a new self-hosted Organization.
_Avoid_: Default password, signup token

**Invite code**:
A single-use credential that admits a new ordinary Member to the existing Organization.
_Avoid_: Organization invitation, Administrator code, signup link

**Coach**:
An organization member who inspects another member's session to diagnose problems or extract reusable practices.
_Avoid_: Admin, supervisor, reviewer

**Administrator**:
An organization member with ordinary member access plus authority to approve and publish Organization standards. The initial bootstrap member is an Administrator, and an organization may have more than one.
_Avoid_: Coach, owner, superuser

## Organizational learning

**Evidence citation**:
A navigable reference connecting an analytical claim to supporting captured activity within a session or turn.
_Avoid_: Unsupported summary, generic session mention

**Repeated pattern**:
An observation supported by evidence from at least two distinct turns, without implying that the observation caused their outcomes.
_Avoid_: Single-case hypothesis, causal finding

**Organization-analysis agent**:
An agent with scoped read access to organization session history that identifies patterns and proposes evidence-backed improvements.
_Avoid_: Admin agent, monitoring bot

**Analysis CLI**:
The scoped command-line interface through which people and organization-analysis agents search, inspect, compare, and cite captured organization data and may submit Candidate skills. It cannot mutate captured evidence, approve a Candidate skill, publish an Organization standard, or deploy one.
_Avoid_: Admin CLI, MCP server

**Codex setup**:
The explicit one-time command flow that configures Codex capture, enrolls the listener to a user, starts the local relay, and verifies delivery.
_Avoid_: Wrapper command, automatic scraping

**Delivery queue**:
The relay's local SQLite-backed store of captured events awaiting idempotent acknowledgement from the central server.
_Avoid_: Central database, event archive

**Central store**:
The PostgreSQL database containing append-only source events and their canonical projections for organization-wide query and analysis.
_Avoid_: Delivery queue, local database

**Analysis skill**:
A coding-agent skill that teaches use of the analysis CLI and requires recommendations to cite supporting sessions.
_Avoid_: Analysis agent, generated skill

**Candidate intervention**:
A proposed improvement supported by observed sessions, such as a skill, workflow, configuration, instruction, automation, or training recommendation. Candidate skill is the only Candidate intervention implemented during the hackathon; the other types preserve the longer-term vocabulary.
_Avoid_: Generated skill, fix

**Candidate skill**:
A versioned, installable skill package proposed with evidence citations and reviewer context for administrator review.
_Avoid_: Skill suggestion, generated text

**Organization standard**:
An administrator-approved intervention made available across the organization.
_Avoid_: Best practice, recommendation

**Organization standard release**:
An immutable, administrator-approved version of an Organization standard that is mandatory on every Enrolled device. Daemons poll for it, verify its approved hash, and install it atomically; Administrators may pause or roll back distribution, and members cannot opt out.
_Avoid_: Mutable standard, automatically approved update, optional member install
