# SelfImpulse

Governed agency. Every effect has a receipt.

A local-first agentic workbench. A human signs over a rehearsed outcome; the kernel replays exactly that
outcome; the result is proved by hash and sealed in an append-only ledger. The model is never trusted
with authority, and nothing outside the Gateway touches the world.

`//impulse`

## What runs today

The shell's geometry is UUI's (`Erealunetra/UUI`): 36px titlebar, 240px sidebar that resizes 136–640,
panels inset 8px on the deep background, session panel docked at 400px minimum, composer pinned under
the timeline. The paint, the motion and the themes are ours. Eight themes — Lunar Ash (default), Anvil,
Moon, Jupiter, Mars, Uranus, Mercury, and AMOLED imported from UUI's theme set — each in dark and light,
all measured for contrast (`npm run design:report`, 16 variants).

```
npm run app        # builds the workbench, starts the harness on :4180  ->  http://localhost:4180/app/
npm run verify     # typecheck, lint, 111 tests (incl. a happy-dom shell contract), design report, slop scan, bundle
npm run preview    # the design preview on :4173  ->  http://localhost:4173/preview/
```

One turn, end to end, with no model in the loop:

1. **Frame.** A deterministic local planner writes a plan for the request.
2. **Rehearse.** The write is staged in a shadow copy through the Gateway, under a sandbox-only order
   revision. Nothing real has happened.
3. **Signature.** The ChangeSet hash is put in front of a human with its effect, data class, recovery
   class and expiry. Docked bar, no modal. Silence expires; it does not proceed.
4. **Commit.** Revision 1 is signed over that exact hash and `commitChangeSet` replays it with
   compare-and-swap, rolling back on drift.
5. **Prove.** The live files are re-read and the checks are re-run through the Gateway. The ledger is
   sealed by the witness.
6. **Retain.** A receipt carries the ledger sequence and hash. The Thread shows what happened.

The approval in this development build is signed by a key the harness holds in-process. There is no OS
keychain integration yet. That is a release blocker (see `BUILD_PLAN.md`), not a claim.

## What exists

| Area | State |
| --- | --- |
| Kernel: `core`, `ledger`, `grants`, `classifier`, `gateway`, `changeset`, `router` | built and tested |
| App harness: `apps/server` (turns, approvals, channel, SSE) | running, partial against the plan |
| Workbench: `apps/desktop/src/app` (36px titlebar with tab strip, resizable sidebar, Thread, session panel, composer region, approval bar) | running, no Electron shell yet |
| Design system: tokens, 8 themes × 2 modes, type, motion, loaders, state glyphs, preview | done |
| Voice: `packages/voice` (sanctioned copy, banned-word audit) | done |
| `memory` coordinator, skills registry, brain loop, web pipeline, drag and drop, Playwright run-through | not built |

`BUILD_PLAN.md` is the authority on status. `AGENTS.md` is the operating contract. `DESIGN.md` and
`docs/DESIGN_SYSTEM.md` are the visual contract. Decisions live in `docs/adr/`.

## Shape

```
packages/    core, ledger, grants, classifier, gateway, changeset, router, memory, voice, states
apps/server  the harness: governed Spaces, turns, approvals, HTTP + SSE channel
apps/desktop
  src/renderer   tokens, themes, type, motion, loaders, state glyphs (the design system)
  src/app        the workbench (TypeScript, bundled by esbuild)
  src/preview    the design preview
scripts/     slop scan, design report, font vendoring, preview server
docs/        ADRs and the design-system guide
```

Two Spaces, never one flag: **Co-think** (personal, `confidential` ceiling, dial 3) and **Co-work**
(organization, `internal` ceiling, dial 2). Each has its own ledger, keys, workspace and thread. There is
no endpoint that spans both.

## Words

Plain, steady, specific, a little dry. Past tense for what happened, future for what is about to.
No hype, no apology, no exclamation marks. `packages/voice` enforces it: a test fails if a status line
contains a banned word.

> Done. Changed 1 file (notes/launch.md). 1 of 1 check pass. Receipts below.

## License

Fonts are OFL-1.1 and vendored under `apps/desktop/src/renderer/fonts/`. Everything else is private.
