# Rules (normative)

## Security and authority
1. The Gateway is the only path to effects. Tools declare `effectClass`, `actionClass`, `recoveryClass`; the model never supplies them.
2. Authority = Order revision (human-signed) -> attenuating Grant chain -> single-use argument-bound Ticket -> Worker. Agents cannot sign, widen, or mint.
3. Changing scope, budget, success checks, policy version, or ChangeSet hash needs a human signature (replan class B). Plan-only changes are class A; narrowing is class C.
4. `decide()` is async, awaited, and **fails closed** on any error or timeout. Advisory components (risk model, guardian timeout) can only raise a requirement.
5. Labels join on derivation (max confidentiality, min integrity) and persist through memory, artifacts, sub-agents, and model outputs. The model cannot lower a label.
6. Untrusted content (web, documents, email, MCP output, CLI output) cannot change plans, policies, skills, or manifests. Process it through the Reader path (no tools, schema-validated typed output) when effectful grants are present.
7. Cloud calls are egress: `restricted` never leaves; secrets in a prompt block the cloud route; keys live in the vault behind the Gateway.
8. R3 (irreversible) actions are never automatic at any trust-dial setting. R1 rollback is verified by hash. R2 compensation can fail and then needs a human.
9. Every effectful call writes an intent before and an outcome after (write-ahead journal). Unsafe tools are never auto-retried.
10. The ledger is append-only and hash-chained; witness-signed Merkle heads are required for tamper evidence. Payloads are stored as hashes plus encrypted sidecars. Never log secrets, prompts, or matched sensitive text.
11. Kill means revoke, terminate workers, verify none remain, record residue. It is not a UI state.
12. Sandbox unavailable = refuse to run (no fallback to the host). Show "Reduced isolation" only for non-effectful work.
13. `learn/` and the Harness Improvement Lab have no write access to gateway, policy, grants, or ledger. Candidates are experiments; promotion needs a human and is versioned with rollback.
14. Memory never grants authority. Memory writes are proposals; only the MemoryCoordinator commits after policy. Every record has Space, scope, provenance, source, and a data label.
15. No cross-Space reads. Cross-Space transfer is an explicit, journaled **Carry** transaction with a unique id and both-side policy checks.
16. Drag and drop never bypasses classifier, quarantine, permissions, approval, or labels.
17. Skills bound to a tool must load, pass integrity and license preflight, and produce an activation receipt **before** the tool is exposed. Skills cannot expand permissions.

## Code
18. TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. No `any`. `as` needs a one-line reason. No non-null `!` outside tests and proven invariants.
19. Zod (or equivalent) at every boundary: IPC, tool args, model output, file formats, MCP and CLI output.
20. Domain names only (`Order`, `Grant`, `Ticket`, `Receipt`, `ChangeSet`, `Carry`). No `utils`, `helpers`, `manager`, `common` modules.
21. No speculative abstraction: an interface needs two implementations or a security reason.
22. No swallowed errors. Return typed results; log with redaction.
23. Shell: `execFile` with argument arrays only; parse commands with a real shell AST for permission rules. No string-built SQL. No `eval`, dynamic `require`, or `new Function`.
24. Paths: normalize, reject `..`, absolute, backslash, NUL; `realpath` plus prefix check; `lstat`; reject symlinks and non-regular files; open with `O_NOFOLLOW`; re-check inode.
25. Comments explain why, not what. No TODO without an ADR or issue id.
26. Time and randomness are injected in kernel code so tests are deterministic.

## Electron
27. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, no `remote`. Fuses: disable `runAsNode`, `NODE_OPTIONS`, and CLI inspect; enable ASAR integrity. Strict CSP. Deny `window.open` and navigation; open external URLs only from an allow-list through `shell.openExternal`. Validate `event.senderFrame` on every IPC handler. Deny all permission requests by default. Untrusted HTML renders only in a sandboxed iframe with no network.
28. The kernel runs as a separate `utilityProcess`; the renderer talks to it through a typed, schema-validated channel.

## Testing
29. Each invariant has a test that fails when the invariant is broken. Algebraic ones use property tests (grant attenuation, label join, state machine, canonical JSON).
30. Add fuzz tests for path handling, canonicalization, and every parser that touches untrusted input.
31. Every UI workflow has an end-to-end test against real backend state. No screenshot-only evidence.
32. Recovery tests: kill mid-call, crash between intent and outcome, restart with duplicate events, drift between rehearse and commit.

## Process
33. Small PRs, one work package each. Conventional commits. ADR for every decision that changes a rule, a dependency, or a trust boundary.
34. CI gate `npm run verify`: typecheck, lint, tests, UI slop scan. Add before release: dependency-cruiser (brain cannot import gateway internals), knip, Semgrep, gitleaks, OSV scan, CycloneDX SBOM, Electron security checks, signed builds.
35. Never claim completion without executed evidence. LOC is not progress.

## Anti-slop (UI and code)
36. UI: no gradients, glow, glass, drop shadows, pill buttons, nested cards, emoji, bounce easing, default AI-look fonts, or colors outside `tokens.css`. Enforced by `scripts/slop-scan.mjs`.
37. Accent color marks state only, never decoration.
38. Empty states show real content (recent sessions, shortcuts), not illustrations.
39. Copy follows the voice rules in `DESIGN.md`.
