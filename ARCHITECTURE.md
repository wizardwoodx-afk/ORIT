# Architecture (normative)

## 1. Shape
One **Harness** powers many **assistants** inside separately governed **Spaces**. Every effect crosses the **trusted kernel**.

```
Renderer (React)  --typed IPC-->  Electron main  --utilityProcess-->  PER-SPACE RUNTIME HOST
                                                        |
   +----------------------------------------------------+------------------------------------+
   | BRAIN (untrusted)                | KERNEL (trusted, small)         | WORKERS (sandboxed)   |
   | assistants, planner, sub-agents  | Gateway: decide / execute       | fs (live, shadow)     |
   | reader (no tools), judge         | Order registry, Grant authority | exec (OS sandbox)     |
   | memory proposals                 | Label engine, Budget meter      | browser (Camofox)     |
   | talks ONLY to Broker             | Model Gateway (router + vault)  | doc (AnyDoc, Readab.) |
   | no fs, net, keys                 | Ledger + intent journal         | craft (CLI/JSON)      |
   |                                  | Carry broker, Kill controller   | accept only tickets   |
   +----------------------------------+---------------------------------+-----------------------+
                          Witness (separate process, own key): signs Merkle tree heads
```
Co-think and Co-work are two instances of this host with **separate** storage and keys, event namespaces, model routes, tool/skill registries, browser identities, schedulers, and approval adapters. They share only kernel code, never state.

## 2. Lifecycle: Frame, Probe, Rehearse, Commit, Prove, Retain
| Phase | Allowed effects | What happens |
|---|---|---|
| FRAME | none | Intake, admission (policy decides whether work may start), Space resolution, assistant selected, success checks drafted |
| PROBE | reads only | Scouts gather context; untrusted content goes through the Reader; memory retrieval with receipt |
| REHEARSE | reads + sandbox | Work is done in a shadow overlay; produces a **ChangeSet** (path, kind, before/after hash) and runs checks there. Sandbox grants come from an auto-activated rev 0 limited to sandbox tools |
| (sign) | none | Human signs the Order revision whose authority includes `changeSetHash`, the exact-file scope, budget, and success checks |
| COMMIT | live effects per grant | **Replays the ChangeSet with no model call.** Each write is compare-and-swap on `beforeHash`. Drift => `DRIFTED`, nothing applied. Mid-flight failure => exact R1 rollback |
| PROVE | reads only | Independent Judge re-reads live state through the Gateway and re-runs signed checks. Verdict: verified / partially verified / not verified / blocked |
| RETAIN | none | Memory candidates, receipts, task recap, improvement signals |

Run states: `draft, framed, approved, rehearsing, ready_to_commit, running, verifying, completed` plus `needs_approval, blocked, failed, cancelled, expired, rolled_back, partially_completed, drifted, recovering, compensating`. A deterministic reducer maps events to state; every transition is an event with actor, cause, policy revision, evidence reference.

## 3. Authority chain
`Order revision (human-signed over authorityHash)` -> `Grant chain (Ed25519, monotonic attenuation: ops, resource, expiry, uses, label ceiling, depth)` -> `Ticket (single-use, short-lived, bound to argsHash and worker)` -> `Worker verifies`.
- Gateway pipeline in order: kill check, schema, manifest, args, resource, phase, policy deny, path classification, grant chain, label flow (declassify needs its own signed approval), trust dial, guardian, risk, approval, budget, ticket.
- Trust dial: 1 Observe, 2 Ask, 3 Flow, 4 Run-scoped, 5 Standing. R3 is never automatic. Standing Orders (detent 5) carry expiry, windows, budget, rate caps, anomaly freeze, digests, dead-man check.
- Recovery classes: R1 exact rollback (hash verified), R2 compensation (can fail), R3 remediation only.

## 4. Information flow
Labels: confidentiality `public < internal < confidential < restricted` plus `personal_sensitive` and `regulated`; integrity `untrusted < tool < user < trusted`. Join on derivation. The Gateway updates the session context label on every result. The classifier fails closed (partial scan, opaque binary, secrets). The Reader/Planner split is triggered when untrusted content and effectful grants coexist.

## 5. Model Gateway (local and cloud)
Roles: planner, worker, judge, reader, summarizer, embedder. Per role an ordered model list. A cloud model is allowed only if: air-gap off, label <= `maxCloudConf` and model limit, prompt has no secrets or regulated identifiers. Refusals are ledgered with reasons. Every result carries a **chip** (`Local` or `Cloud: provider`) shown in the UI. Keys never reach the brain. Disable cross-Space prompt/KV cache sharing in local runtimes (one runtime instance or cache namespace per Space).

## 6. Memory (L0-L10, plus L11 evidence)
L0 working, L1 recall, L2 task, L3 episodic, L4 semantic, L5 profile, L6 procedural, L7 project, L8 domain, L9 organization, L10 harness-learning; **L11 = the ledger, never blended**.
- One owning Space per record; scope in `personal_space, organization_space, assistant, project, work_order, session, thread, domain_pack`.
- Write pipeline: capture, candidate, provenance, scope from trusted context, classify, admit, normalize, conflict analysis (never silently overwrite confirmed facts), confidence/expiry, transactional commit + receipt, async index, expose to user.
- Retrieval: scopes derived from principal + assistant manifest + trusted context (never from model text); structured first, FTS5 lexical, optional local vectors; re-authorize after index lookup; rank by relevance, confidence, recency, salience; drop expired/superseded/retracted; flag contradictions; per-type token budgets; write a retrieval receipt separating **used** from **available**.
- Storage: SQLite canonical, FTS5 index (rebuildable), content-addressed blobs, per-Space key. Encryption at rest is a release gate.
- Controls: remember, forget, correct, why-retrieved, why-saved, pause learning, export, delete (tombstone + deletion receipt).

## 7. Harness layers (build order)
Assistant Registry (versioned manifests per Space) -> Intake and Admission -> Planner (typed plan DAG with risk, budgets, skill/tool needs) -> **Skill Resolver** (load, verify, activation receipt, then expose tool) -> Tool Registry and Capability Broker -> Work Graph Orchestrator (assignments, retries, checkpoints, cancellation) -> Worker Runtime -> Verifier -> Witness and Evidence -> Outbox and Attention Manager -> Recovery Manager. **Harness Improvement Lab** (Propose, Probe, Evaluate, Review, Promote, Retain) runs in a sandbox on versioned bundles; security invariants are not optimization targets and never auto-promote.
Assistant manifest fields: id, version, Spaces, role, instructions, model policy, tool capabilities, required skill bindings, memory read/write types and scopes, delegation depth and concurrency, budgets, proactive subscriptions, verifier suite, UI surface. A model cannot change its manifest or Space.

## 8. Adapters (each behind an interface, each verified before use)
| Adapter | Role | Key constraints |
|---|---|---|
| Camofox | Public web search and read | Isolated worker, localhost + API key, cookie import off, telemetry off, pinned digest, best-effort (no evasion guarantee), pluggable `SearchProvider` |
| ego(lite) | Signed-in personal browser | Separate process, profile, cookies, permissions; never shared with Camofox |
| Readability + Turndown | Web article to Markdown | Sanitize before conversion; output labeled `untrusted` |
| AnyDoc (firecrawl/anydoc) | Document to Markdown | Parser isolation, quarantine, size and time limits, classifier first |
| Craft apps (ArtCraft/Storytold) | Creative and document tools | Native CLI/JSON through Gateway, per-app schema validation, tool-skill binding |
| MCP | External tools | Per-Space allow-list, manifest digest pinning, outputs untrusted |
| IsolationBackend | OS sandbox for exec workers | `@anthropic-ai/sandbox-runtime` (Seatbelt, bubblewrap; Windows alpha) or container; explicit deny-read list; refuse if unavailable |

## 9. Storage and processes
Per-Space data root: `ledger.db`, `memory.db`, `work.db`, `blobs/`, `artifacts/`, `keys/` (OS keychain wrapped). Rebuildable: FTS and vector indexes. Process tree: Electron main, renderer (sandboxed), per-Space `utilityProcess` host, worker processes, witness, optional Camofox process. Everything long-running lives in the host, so scheduled and proactive work continues with the window closed.

## 10. Failure and recovery
Intent journal replays on boot (`UNKNOWN` outcomes reconcile or go to a human). Leases and heartbeats for running nodes. Capability or approval expiry moves the run to `expired`. Carry transactions converge to committed or aborted after any crash. Witness heads are verified by `selfimpulse verify`, which also reports time since last anchor.

## 11. Proactive behavior
Triggers (schedule, watchers, calendar and mail events, CI failures, idle review) produce **Nudges**: why it fired, evidence, confidence, draft Order. Ladder: Notice, Prepare (shadow only), Act (only under a signed Standing Order). Daily caps, quiet hours, confidence floor, self-pacing backoff. Feedback (snooze, never, always) updates preferences. Proactive work never mints grants.

## 12. Current implementation map
| Package | State |
|---|---|
| core, ledger, grants, classifier, gateway, changeset, router | Built and tested |
| memory | Types only (coordinator, store, retrieval, Memory Center: not built) |
| skills, lab, web adapters, dragdrop, exec worker + sandbox adapter, witness process, control plane | Not built (see BUILD_PLAN.md) |
| brain loop (`packages/brain`): loop, tool host, governed tools, prompt; providers via the router (Anthropic + OpenAI-compatible) | Built (ADR 0005) |
