# Build Plan and Status

Status words: **done** (tests + evidence), **partial**, **not started**. Update honestly after every work package. Order is dependency-driven; each phase has an exit gate.

| # | Phase | Status | Remaining work | Exit gate |
|---|---|---|---|---|
| 0 | Repo, rules, verify gate, threat model | partial | STRIDE + OWASP agentic map in `docs/THREAT_MODEL.md`; dependency-cruiser, knip, Semgrep, gitleaks, OSV, SBOM in CI; `docs/RESEARCH_REGISTER.md` | `verify` + extra gates green in CI |
| 1 | Trusted kernel (`core, ledger, grants, classifier, gateway`) | done for in-process | Separate **kernel process** and typed IPC; **exec worker** + `IsolationBackend` adapter (sandbox-runtime) with refusal tests; **witness** as its own process; DB encryption adapter; per-Space key wrapping | Brain process cannot touch fs/net; sandbox-unavailable refuses; kill leaves no PIDs; tamper after anchor detected |
| 2 | Rehearsal loop (`changeset`) | done for files | Generalize ChangeSet beyond text files (spreadsheets, documents), shadow copy for command-based checks, R2 compensation handlers, Order revision classes A/B/C wired into the runner | Drift, rollback, tamper, scope tests green on real workflows |
| 3 | Model Gateway (`router`) | done | Local runtime adapters verified against real Ollama and llama.cpp servers; pseudonymization hook; per-Space runtime/cache isolation test; usage and cost metering into budget | Real local model run + cloud-blocked-by-label test |
| 4 | **Memory** (`memory`) | types only | MemoryCoordinator (propose, approve, reject, retrieve, revise, supersede, expire, delete, carry); SQLite store + FTS5; L0 working, L1 recall, L2 checkpoints; profile block; retrieval receipts (used vs available); retention; consolidator (candidates only); Carry journal; Memory Center data API | Memory acceptance tests in `docs/quality/` pack: isolation, provenance required, conflict never silent, deletion tombstone, L10 compat filter |
| 5 | **Skills and tool binding** (`skills`) | not started | Skill registry, binding manifests, preflight (health, integrity, license, version), activation receipts, tool exposed only after load; skill supply-chain audit | Tool unavailable when a required skill fails; receipt precedes first call |
| 6 | **Harness** (`harness`) | partial | Running: `apps/server` boots a governed Space, runs turns through rehearsal → signature → commit → prove, and serves the Thread over SSE. Remaining: durable event store, supervisor, independent verifier, outbox/attention, scheduler, two assistants in both Spaces at once | Assistant registry and manifests; per-Space runtime hosts; intake and admission; planner interface; work graph reducer and durable event store; supervisor; independent verifier; outbox and attention; recovery manager; scheduler | Same harness runs two assistants in both Spaces with no shared state; duplicate/cancel/restart tests |
| 7 | Brain loop (`brain`) | not started | Own agent loop (async generator), provider interface via Model Gateway, stall/oscillation detectors, Reader path, sub-agent spawn with attenuated grants and shared budgets, compaction | End-to-end task: Frame to Prove on a real repo with a local model |
| 8 | Web and documents (`web`, `doc`) | not started | Camofox worker + `SearchProvider`; Readability + Turndown pipeline; AnyDoc adapter; file intelligence quarantine; ego(lite) separate worker; Craft CLI/JSON provider (app by app) | Each adapter verified per `docs/RESEARCH_REGISTER.md`; browser content labeled untrusted |
| 9 | Desktop (`apps/desktop`) | partial | Done: 2-theme token contract with measured floors (ADR 0002), vendored reading face, motion table and loaders, 15 shared state glyphs, design preview, and a running workbench (`npm run app`: rail, Thread, dock, composer, docked approval bar) driven by the real harness over SSE. Remaining: hardened Electron shell, kernel `utilityProcess`, keychain-held human key, command palette, settings page, drag and drop, Memory Center, accessibility pass | Playwright E2E on real backend state; slop scan clean; keyboard-only run-through |
| 10 | Proactive + Improvement Lab (`lab`) | not started | Nudges, Standing Orders, digests; Propose-Probe-Compose lab with baseline, golden tasks, security gate, human promotion, rollback | Lab cannot self-promote; proactive work never mints grants |
| 11 | Control plane (V1.1) | not started | Identity, org policy bundles, device enrollment, four-eyes approvals, audit sync | Enterprise gates in pack `RELEASE_GATES.md` |
| 12 | Release qualification | not started | Signing, notarization, update rollback, SBOM, pen-test, perf, accessibility audit | Every release gate passes with evidence |

## Next five work packages (in order)
1. **Kernel process split + exec worker + sandbox adapter.** Tests: brain cannot import gateway internals (dependency-cruiser); sandbox missing => refusal; kill reaps process groups.
2. **MemoryCoordinator and store.** Write the acceptance tests first from `MEMORY_AND_DRAG_DROP_ACCEPTANCE.md`.
3. **Skill resolver and tool registry.**
4. **Brain loop with scripted provider, then a real local model.**
5. **Desktop shell and the first real workflow screen:** Thread + Changes dock + approval bar + Receipt, wired to the kernel.

## Release blockers (do not ship without)
DB encryption at rest; sandbox-backed exec workers on all supported OSes (or documented unsupported); witness in a separate process with anchored heads; independent security review; signed builds with rollback; every adapter verified at a pinned version.
