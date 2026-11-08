# ADR 0003: The app server, and esbuild as the only new dependency

- Status: accepted
- Date: 2026-11-08
- Deciders: implementer, within the owner's "build the backend and the frontend" instruction

## Context

The repository had a kernel (`core`, `ledger`, `grants`, `gateway`, `changeset`, `router`, `memory`
types) and design tokens, but no running application: no process that holds runtime state, no channel,
and no screen. The owner asked for the backend and for the repository to become the frontend.

Constraints: TypeScript strict, Zod at every boundary, the kernel is the only path to effects, no
silent fallback, one Space cannot read another, and a dependency needs an ADR with reason, license,
size, maintenance and alternative.

## Decision 1: `apps/server` is the harness, not a second brain

`apps/server` boots one governed Space per context: its own `Ledger` (SQLite file), its own keys
(human, agent, root, gateway, witness), its own `OrderRegistry`, policy bundle and two workers (`fs`
live, `shadow` rehearsal). It exposes an HTTP channel and an SSE event stream, and nothing else.

A turn is a real path through the kernel:

1. Frame: a deterministic local planner writes a plan. No model is called, so nothing pretends to be
   intelligence; the governance path is what is exercised.
2. Rehearse: `Rehearsal` stages the write in the shadow root through the gateway with an
   `activateSandboxOnly` order revision.
3. Signature: the ChangeSet hash is put in front of a human. The approval desk expires rather than
   proceeding.
4. Commit: revision 1 is signed over the exact ChangeSet hash, then `commitChangeSet` replays it with
   compare-and-swap and rolls back on drift.
5. Prove: `prove` re-reads the live files and re-runs the checks; the ledger is sealed by the witness.

Restated honestly: in this development build the server holds the human signing key, because there is
no OS keychain integration yet. That is a harness convenience and a release blocker, not a design
claim. It is recorded in `BUILD_PLAN.md` phase 0/1.

Runtime data lives in `.selfimpulse/` (ledger, thread log, workspace, shadow) and is gitignored.

## Decision 2: esbuild, dev-only, for the renderer bundle

The renderer is TypeScript. Browsers cannot run it, and the repo has no bundler. Options considered:

| Option | Verdict |
| --- | --- |
| Hand-written plain JS renderer | Loses `strict`, `noUncheckedIndexedAccess` and the shared types on the largest surface in the app |
| `tsc` emit plus import maps | Works, but every workspace package must be emitted and mapped by hand; the failure mode is a blank screen |
| **esbuild** | One binary, 80ms builds, resolves workspace packages and `.ts` exports, no runtime footprint |

Accepted: `esbuild@0.28.2`, MIT, dev dependency only, ~9 MB installed, maintained by the Vite and
TypeScript-adjacent ecosystem, single static binary. It bundles `apps/desktop/src/app/main.ts` into
`apps/desktop/dist/app/main.js` (462 KB minified, which includes Zod for boundary validation).

This does not change the STACK decision to use electron-vite for the packaged desktop app. It is a
build step that exists so the workbench runs today, and it is removed when electron-vite lands.

## Decision 3: the wire is generated, not guessed

`apps/desktop/src/app/api.ts` holds Zod schemas for every event and for the snapshot. A test
(`apps/server/test/wire.test.ts`) runs a real turn and parses every emitted event against the
renderer's schema, so a server change that breaks the UI fails in CI rather than in the UI.

## Consequences

- `npm run app` builds the renderer and starts the harness on `:4180`, serving `/app/` and the channel
  from one origin. No CORS, no second host, no credential in the browser.
- The state vocabulary moved to `packages/states` so the kernel host and the renderer cannot disagree
  about what a state is called; glyphs stay in the renderer.
- Still missing, and named as missing: no Electron shell, no OS keychain, no model provider wired to a
  real endpoint, no memory coordinator, no drag and drop, no Playwright run-through. See `BUILD_PLAN.md`.

## Alternatives rejected

- A second brain in the server "just to make it feel alive": that is the fake UI the rules forbid.
- WebSocket instead of SSE: SSE is enough for a one-way event log, survives reconnects with a cursor,
  and needs no protocol library.
- Rendering directly from fetch polling: the stream is the reason the Thread can show states in the
  order the kernel produced them.
