# Design System and UX (normative)

Targets: **OpenCode Desktop** (shell, session tree, review panel, terminal, settings) and **Qoder Desktop** (three-column task view, composer, right context dock, sub-agents, artifacts, skills/MCP panels). Study `SELFIMPULSE_BUILD_PACK/reference-screenshots/` before building any screen. Match structure and density, not branding. Visual tokens live in `apps/desktop/src/renderer/tokens.css`; the scanner rejects anything outside them.

## 1. Principles
Dense, quiet, keyboard-first. The interface shows real state and gets out of the way. Color means state. Motion explains a change; it never decorates. Every action has a visible state, an error path, and a cancel.

## 2. Layout
- **Left rail (264px, resizable 220-360):** Space switcher (Co-think / Co-work with tint and policy ceiling visible), then a tree: Projects > Workspaces > Sessions as 28px rows, status glyph at the left, unread/needs-approval dot at the right, archive on hover, middle-click opens in a tab.
- **Center:** session tabs, the conversation and the **Thread** (steps, sub-agent rows, receipts), and the **composer** pinned at the bottom.
- **Right dock (min 360, resizable, drag to reorder tabs):** Plan, Changes (git-style review with hunk navigation, auto-collapsed lockfiles and generated files), Receipts, Files, Browser, Terminal, Artifacts, Memory Used, Sources. Remembers last tab and scroll per session.
- **Composer:** text area, attachments (drop or paste), `/` commands, `@` references, `!` shell (agent terminal only). Chip row: assistant, Space, **model chip (`Local` or `Cloud: provider`)**, thinking level, trust dial. A send button that becomes Stop while running. Drafts persist across navigation.
- **Command palette (cmdk):** every action, with keybindings shown; preserves the composer draft.
- **Two terminals:** the user's terminal (their authority) and the agent terminal (ticketed, read-only mirror with explicit take-over).
- **Settings** as a full page like OpenCode: Appearance, Models and routing, Spaces and policy, Memory Center, Skills and tools, Browser (Camofox and ego(lite) separate), Privacy, About with `verify` results.

## 3. Tokens
Base `#000000` (AMOLED) with `#0b0b0c / #121214 / #1a1a1d` elevation steps and 1px `#26262a` lines. Text `#e6e6e3` (never pure white), dim `#a3a3a0`, faint `#6b6b69`. Accents appear **only as state**: Co-think bone `#d8d3c8`, Co-work verdigris `#5fa38b`, attention amber `#e0b04f`, danger `#e0605a`. Success is a neutral check plus text, not green. Provide a Graphite theme (`#0e0f11` base) and a light "Paper" theme for bright offices; same tokens, different values. Note: bone and verdigris sit close to the current "tasteful cream and sage" AI tell, so they must never fill panels or headings.

## 4. Type, spacing, icons
- IBM Plex Sans for UI, JetBrains Mono for code, terminal, hashes, timers. Four sizes only: 11 meta, 13 body, 15 section, 20 title. Weights 400/500/600. Tabular numerals for timers, costs, counts.
- 4px spacing scale. Rows 28px, toolbars 32px, radius 4px controls and 6px panels. No pills.
- One icon set: Phosphor Regular at 16 and 20px, one stroke weight. Custom state glyphs (running arc, waiting ring, check, cross) drawn on the same 16px grid. No emoji, ever.

## 5. State vocabulary (never collapse into a spinner)
`draft, framed, needs approval, rehearsing, ready to commit, running, verifying, completed, blocked, failed, cancelled, expired, rolled back, partially completed, drifted`. Each has a glyph, a label, and a reason line.

## 6. Motion and loaders
Global: only `transform` and `opacity`; micro 120ms, panels 200ms, nothing over 300ms; easing `cubic-bezier(0.2, 0, 0, 1)`; no bounce; pause when the window is hidden; virtualize long lists; honor reduced motion (fades of 1ms and static markers).
| Moment | Treatment (must be driven by real events) |
|---|---|
| Thinking | The word "Thinking" with a slow text shimmer (mask sweep, 1.6s), mono elapsed timer, thinking-level badge, collapsible reasoning summary (never raw hidden reasoning) |
| Web search | Row with the query, hairline indeterminate bar, source chips appear staggered 40ms as monochrome domain initials (no third-party favicon fetches), live count |
| Reading a page | One row per URL: queued, loading (short rotating dash), read, blocked. Opens the untrusted snapshot |
| Sub-agents | Child rows hang off the Thread on a 1px vertical line; glyph per state (arc running, hollow amber ring waiting, drawn check, cross); rows slide in at most 8px; collapsed summary `3 agents, 2 done, 1 running`; Send to background; each child shows its attenuated grant and budget |
| Tool run | Mono command line, clipped streaming output, stepped cursor, timer, receipt on finish |
| Rehearsing | Dashed Thread segment and a "Rehearsing" tag: not real yet |
| Committing | The dashed segment turns solid in a 200ms left-to-right wipe: the one deliberate moment |
| Needs approval | Docked bar rises 8px with exact effect, target, data, risk, duration, rollback class; amber dot; no modal, no shake |
| Receipt | Clip-reveal 8px; rolled-back receipts strike through and re-stamp |
| Loading | Static skeletons only after 300ms; no shimmer except the Thinking label |

## 7. Receipts, approvals, and honesty UI
- Every effectful action renders a **Receipt**: what, why, grant, resource, hash, and the recovery label **Roll back** (R1), **Reverse** (R2), or **Remediate** (R3).
- Approval cards show the exact arguments hash and the provenance of sensitive values (recipient, path, amount). R3 needs an explicit acknowledgment: "This can't be undone."
- Every model message shows its location chip. A persistent indicator shows when data left the device this session.
- Memory Used (what entered context) is separate from Memory Available. Never imply a memory was used when it was only available.
- Skill and tool activation receipts are visible in the Plan tab before the tool runs.

## 8. Drag and drop (first class; each target shows allowed/denied before drop)
Sources: OS files and folders, chat messages, excerpts, artifacts, sources, Work Orders, assistants, tools, skills, memory references, tabs, dock panels, task cards. Targets: composer, session, project, Work Order, task board, dock, artifact canvas, assistant slot, Memory Center.
- Every drop resolves to a typed **intent** (attach, reference, assign, move, carry, reorder) with a preview; ambiguous drops ask once.
- Files pass the classifier and quarantine before any agent can read them; credential files are refused with a reason.
- Cross-Space drops are never plain moves: they open a **Carry** review (source label, destination owner, policy result, approval).
- Everything has a keyboard path (select, "Move to...", "Attach to...") and screen-reader announcements. Every move is undoable.
- States: idle, draggable, drag-over allowed, drag-over denied (with reason), dropped, processing, failed. Escape cancels.

## 9. Proactive and attention
Quiet by default. One acknowledgment per request, progress in the task monitor, one concrete question when blocked. Nudges live in My Attention with why-it-fired and evidence; never modal. Snooze, never, always.

## 10. Voice
Plain, steady, specific, a little dry. Past tense for what happened, future for what is about to.
| Don't | Do |
|---|---|
| "Successfully completed!" | "Done. Changed 3 files, 14 checks pass. Receipts below." |
| "Oops, something went wrong." | "Blocked: org policy forbids sending restricted data outside (rule P-14)." |
| "Are you sure?" | "This can't be undone. If it goes wrong, here's what I can do instead." |
| "I think maybe..." | "About 60% sure. Here's what would change my mind." |
No hype words, no claimed feelings, no emoji in system text.

## 11. Accessibility
Body contrast at least 7:1 on black. Visible 1.5px focus ring. 28px minimum desktop targets. Full keyboard operation including drag and drop. Live regions for status changes. High-contrast theme. Reduced motion supported. Tooltips show keybindings.

## 12. Anti-slop checklist (CI enforced where possible)
No gradients, glow, glass, drop shadows, nested cards, pills, emoji, bounce, default AI-look fonts, off-token colors, decorative accent fills, illustration empty states, fake progress, or invented capabilities. Every screen is reviewed against the reference screenshots and the token scanner before merge.
