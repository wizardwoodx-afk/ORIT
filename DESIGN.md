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

### 2.1 As built (placements are UUI's)
The workbench does not invent a layout. It takes UUI's (`Erealunetra/UUI`, `src/app/shell`, `src/app/session`)
and repaints it:

- **Titlebar 36px** carrying the sidebar toggle, the **tab strip** (one session tab per Space, with the live
  state chip), and the ledger truth at the end.
- **Sidebar 240px default, resizable 136–640** by drag or arrow keys, clamped and remembered; brand row,
  `New session` row with its keybind, `Spaces`, then `Sessions`.
- **Panels inset 8px** on the deep background, hairline frame and 6px radius, exactly as UUI frames its shell.
- **Session panel docked at 400px minimum** — UUI's `SESSION_PANEL_WIDTH_MIN` — with `plan`, `receipts`,
  `ledger`, `files`, and `appearance` as its panes. UUI puts theme choice in settings; so do we.
- **Composer region pinned under the timeline**: bordered card, textarea, then the control row (assistant,
  model, attach, dial, send). The card grows the timeline upward instead of floating.
- Not yet built from that shell: the project tree above sessions, the command palette, deep link panes,
  the peek sidebar, and the second terminal. ADR 0004 records the gap.

## 3. Tokens
`apps/desktop/src/renderer/tokens.css` is the only file where raw color may live. Eight themes, each in a
dark and a light mode:

| theme | note |
| --- | --- |
| **Lunar Ash** (default) | AMOLED soft. Cool ash on near-black. |
| **Anvil** | SelfImpulse house. Ink, steel, warm bronze support. |
| **Moon** | True AMOLED neutral. No tint, no chrome. |
| **Jupiter** | Warm sepia and brass. |
| **Mars** | Rust and dust. |
| **Uranus** | Deep teal, cold and low glare. |
| **Mercury** | Warm graphite. |
| **AMOLED** | Imported from UUI's theme set (`src/theme/themes/amoled.json`), the only UUI palette carried across. |

All seven owner palettes stay; the earlier cut to two themes was reversed (ADR 0002 now records both the
attempt and the reversal). UUI's other 35 palettes are deliberately not imported: one theme proves the
import path, thirty-five would be 35 unmeasured surface steps.

`data-theme` selects the palette, `data-mode` the mode, and `data-contrast="high"` remaps dim text and
lines across every theme instead of adding a ninth.

Every theme defines the same 23-token contract: `--bg` page, `--s1` panel, `--s2` elevated control,
`--line` and `--line-strong` hairlines, `--fg` / `--fg-dim` / `--fg-faint` text, `--btn` and `--btn-fg`
primary button, `--accent` fill, `--accent-ink` text and glyph accent, `--co-think` and `--co-work`
Space tints, `--attn` attention, `--danger` failure, `--diff-add` / `--diff-del` fills, `--hover` /
`--active` / `--selected` / `--scrim` overlays, `--focus` ring.

Rules:
- Color means state. `--accent` fills selection, focus, and the one commit wipe; it never fills a panel,
  a heading, or an empty state. `--accent-ink` is the readable form of the same hue and is what glyphs
  and accent text use.
- Accents appear only as state: attention amber for needs-approval and blocked, danger for failed,
  `--co-think` / `--co-work` as a dot or a 1px rule for the Space identity. Success is a neutral check
  plus text, never green.
- Imported palettes are borrowed hues, not borrowed colors. UUI's AMOLED ships `#00e676` on `#f0f0f0`
  (1.4:1) for success and `#ffab00` (1.5:1) for warning in light mode; those become derived `--attn`
  and `--danger` steps that clear the floors, and the raw values are recorded in ADR 0002.
- Contrast floors are measured, not eyeballed: body 7:1, secondary 4.5:1, tertiary and state glyphs 3:1,
  control border 1.5:1, button label 4.5:1, text on a diff fill 4.5:1. `npm run design:report` fails the
  build when any theme in either mode misses one — 16 variants today.

## 4. Type, spacing, icons
- **UI:** IBM Plex Sans (400/500/600 + italic), for chrome, controls, labels.
- **Reading:** Source Serif 4 by default, Newsreader and Instrument Serif selectable via `data-serif`
  (all OFL, vendored as woff2, no CDN). Serif is for titles and long-form answers, never for controls.
- **Mono:** JetBrains Mono variable, for code, terminal, hashes, timers, costs. Tabular numerals always.
- Five sizes only: 11 meta, 13 body, 15 section, 17 read, 20 title (23 for the serif display title).
  Weights 400/500/600. Optical size is on for the serif.
- Reading set at 17px/1.6, measure 68ch. Conversation chrome stays at 13px.
- 4px spacing scale. Rows 28px, toolbars 32px, rail 264px (220-360), dock minimum 360px, radius 4px
  controls and 6px panels. No pills.
- One icon set: Phosphor Regular at 16 and 20px, one stroke weight. Custom state glyphs (running arc,
  waiting ring, check, cross) are drawn in code on the same 16px grid. No emoji, ever.

## 5. State vocabulary (never collapse into a spinner)
`draft, framed, needs approval, rehearsing, ready to commit, running, verifying, completed, blocked, failed, cancelled, expired, rolled back, partially completed, drifted`. Each has a glyph, a label, and a reason line.

## 6. Motion and loaders
Global: only `transform` and `opacity`; micro 120ms, panels 200ms, nothing over 300ms except the two
ambient loops (Thinking 1600ms, rotating dash 1000ms); easing `cubic-bezier(0.2, 0, 0, 1)`; no overshoot;
pause when the window is hidden; virtualize long lists; honor reduced motion (1ms fades, animation off,
static markers instead of loops). The moments are declared as data in `motion.ts` and a test enforces the
limits, so a component cannot invent a longer or stranger transition.
| Moment | Treatment (must be driven by real events) | Implementation |
|---|---|---|
| Thinking | The word "Thinking" with a slow shimmer, mono elapsed timer, thinking-level badge, collapsible reasoning summary (never raw hidden reasoning) | `.thinking`, per-glyph opacity step at 1600ms |
| Web search | Row with the query, hairline indeterminate bar, source chips appear staggered 40ms as monochrome domain initials (no third-party favicon fetches), live count | `.loader-hairline`, `.source-chip` with `--i` |
| Reading a page | One row per URL: queued, loading (short rotating dash), read, blocked. Opens the untrusted snapshot | `.loader-dash` |
| Sub-agents | Child rows hang off the Thread on a 1px vertical line; glyph per state; rows slide in at most 8px; collapsed summary `3 agents, 2 done, 1 running`; each child shows its attenuated grant and budget | `.child-rows`, `.enter-row`, `.agents-summary` |
| Tool run | Mono command line, clipped streaming output, stepped cursor, timer, receipt on finish | `.caret`, `.receipt` |
| Rehearsing | Dashed Thread segment and a "Rehearsing" tag: not real yet | `.rehearsed`, `.commit-track` |
| Committing | The dashed segment turns solid in a 200ms left-to-right wipe: the one deliberate moment | `.commit` with `data-phase` |
| Needs approval | Docked bar rises 8px with exact effect, target, data, risk, duration, rollback class; amber edge; no modal, no shake | `.approval-bar` |
| Receipt | Reveal of 8px; rolled-back receipts strike through and re-stamp | `.receipt`, `data-recovery="rolled-back"` |
| Loading | Static skeletons only after 300ms; no shimmer except the Thinking label | `.skeleton` |
| Progress | Determinate bars scale on `transform`, never reflow | `.progress` with `--value` |

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
