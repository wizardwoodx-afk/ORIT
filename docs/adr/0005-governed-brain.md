# ADR 0005: The brain is a governed loop, not an autonomous one

- Status: accepted
- Date: 2026-11-08
- Deciders: owner
- Related: ADR 0003 (app server), ADR 0004 (shell placements)

## Context

The harness could already frame, rehearse, commit, prove and retain a change — but a deterministic
template wrote every file, so there was no agent. The owner asked for the backend of the agent: both
provider families, a full loop, and real tools. The constraint that makes this decision interesting is
that this product's whole claim is that a model never holds authority. An agent loop is exactly where
that claim usually dissolves, because a loop needs to act to be useful.

## Decision

`packages/brain` is the agent, and it is structurally unable to act.

| piece | file | what it may do |
| --- | --- | --- |
| loop | `src/loop.ts` | call the provider, run tools the host offered, feed observations back, stop on a real condition |
| tool host | `src/tools.ts` | accept or refuse a call by name; a failing tool returns an observation, never an exception |
| governed tools | `src/gateway-tools.ts` | translate one model call into one broker call; there is no direct filesystem path |
| prompt | `src/prompt.ts` | the owner's prompt, one constant, assembled with this Space's facts |

**The loop cannot touch the world.** Every tool is a `Broker.call`. Writes go to the shadow copy through
`Rehearsal.stageWrite`; reads go to the live tree through the read-only `fs.read`. The only tool that
changes anything is `write_file`, and its effect class is `sandbox`. Live writes never appear in the tool
list, so a jailbroken model has nothing to call: the gateway would deny `fs.write` in `REHEARSE` on the
phase gate before any other check ran.

**The model's plan becomes the human's approval.** In `apps/server/src/agent-turn.ts` the brain runs
inside the rehearsal revision, the resulting ChangeSet is what gets signed, and the commit replays
exactly those bytes. `turn-core.ts` holds that path in one place, so the template and the brain cannot
diverge: the deterministic planner and a model take the same approval, the same revision escalation, the
same compare-and-swap, the same prove, the same receipts.

**Providers live behind the router.** Two adapters — `AnthropicProvider` (Messages API, system prompt
lifted out, `tool_use`/`tool_result` blocks, ids preserved) and `OpenAICompatProvider` (function tools,
`tool_calls`, tool-role messages) — plus a `ScriptedProvider` for tests. All three are reached through
`ModelGateway`, which owns air-gap refusal, label ceilings, secret scanning, token reservation, the
`Local`/`Cloud:` chip, and a `model.call` ledger row per step. A key is read in exactly one function
(`createBrain`) and never reaches the loop.

**Routing is configured, not inferred.** `SI_PROVIDER`, `SI_MODEL`, `SI_BASE_URL`, `SI_API_KEY`,
`SI_AIRGAP`, `SI_CLOUD_CEILING`. No provider configured is a valid state: the harness runs the
deterministic template and `/api/health` says `deterministic planner (no provider configured)`. A
configured provider that fails fails the turn with a `blocked` state — it never silently degrades into
the template, because that would be a lie about what ran.

**Stops are first class.** `done`, `steps`, `budget`, `aborted`, `error`. Each is reported with the
reason that produced it, and a step that proposes more calls than the per-step limit says so
(`proposed 6 calls; 2 ran`). An abort runs nothing further and signs nothing.

**A refusal is an observation.** A denied tool, an unknown tool name, or a failing tool is a message the
model sees, not an exception the server throws. The one exception reserved is an unknown name at the host
boundary, which is a caller bug.

### One change outside the brain: the grant algebra

An agent chooses paths at runtime, so its rehearsal grant has to name a whole scheme. The algebra only
understood `dir/**`, which matches `fs:notes/a.md` but not `fs:a.md` — the first model-driven turn failed
with `grant: resource not granted` on the baseline read, exactly as it should have. `prefixOf` now also
accepts a bare `**` (`fs:**`), and `isSafeResource` checks for `..` behind the scheme prefix, because
`fs:../etc/passwd` is otherwise a legal-looking string. Tests cover both.

## Consequences

- The same governance covers a model and a template. A test asserts a scripted model's write reaches the
  live tree only after a signature, with a receipt (`apps/server/test/agent.test.ts`).
- 141 tests. The loop has 15 of them, the providers 7, the turn 4, and none of them touch a network.
- Streaming is partial: the Thread shows the plan and the final message, and each model step is a ledger
  row, but per-step assistant/tool rows are not yet events on the thread. Token deltas are not wired at
  all. That is the next slice, and it is a UI-schema change, not a loop change.
- The vocabulary has no "answered without an effect" state. A turn that stages nothing reports
  `completed` with an explicit reason — `Answered in words. Nothing needed a signature.` — rather than
  borrowing a state that means something else. Naming it properly is a design change, not a patch.
- The human signing key is still held in-process by the harness. This is now the only thing between the
  current build and an agent backend that can be handed to someone else.
- No model has been called from this environment: egress here is npm/PyPI/GitHub only, and there is no
  key. Every provider path is tested against a fake transport, and the first real call is the owner's to
  make.
