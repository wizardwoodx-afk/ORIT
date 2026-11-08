# ADR 0004: Shell placements are ported from UUI, not reinvented

- Status: accepted
- Date: 2026-11-08
- Deciders: owner
- Related: ADR 0002 (themes), ADR 0003 (app server and bundle)

## Context

The owner's instruction was to build the backend and then build the frontend by taking UUI's
"positions, placements and all", adding our animation, transitions, theme colours and loaders on top,
adapted to SelfImpulse. The source is `Erealunetra/UUI` — a SolidJS + Vite desktop client. We are not
porting its framework, its state machines, or its data model; the app runtime here is our own
(ADR 0003). What is being taken is geometry.

## Decision

Measured from UUI `src/app/shell/shell.tsx`, `src/app/shell/titlebar/*`, `src/app/session/screen.tsx`,
`src/app/composer/*`, and reproduced in `apps/desktop/src/app`:

| UUI | value there | what we ship |
| --- | --- | --- |
| titlebar height | 36px (44 on Windows) | `--titlebar: 36px`, toggle + tab strip + ledger truth |
| sidebar width | 240 default, 136 min, 640 max | `--rail: 240px`, `--rail-min: 136px`, `--rail-max: 640px`, drag or arrow-key resize, persisted |
| shell inline inset | 8px | `--inset: 8px` around the panel grid |
| session panel min | `SESSION_PANEL_WIDTH_MIN = 400` | `--dock-min: 400px`, docked pane tabs on the head |
| panel motion | `createPanelMotion`, `panelOpacity` | dock/rail toggles are `visibility` + width; no shadow, no slide of the whole shell |
| composer region | grows the timeline, pinned at the foot | `.composer-region` under `.timeline-wrap`; the card grows the Thread upward |
| composer anatomy | editor, then control row: attach, model chip, send | textarea, then assistant / model / attach / dial / send |
| settings holds appearance | theme grid in settings, not the titlebar | `appearance` pane in the session panel: 8 themes, mode, serif, contrast |

Deliberately not ported: `@property`-driven panel opacity machines, the peek sidebar, plugin slots,
the command palette, the project tree above sessions, deep link panes, terminals. They are recorded as
gaps rather than stubbed, because a stubbed pane is a lie about the backend.

Fake affordances were removed rather than styled: the tab strip's close button (one session per Space by
contract), the attach control and the dial chip (both `disabled`, with a title saying why). A control
that does nothing is worse than an absent control.

## Consequences

- Geometry is now a fixed contract; the design tests pin the token values and the report pins contrast.
- The workbench imports UUI's placements but no UUI code, so there is no licence coupling and no
  framework in the bundle (467.6 kB, esbuild, no runtime deps).
- Pane tabs are UUI's arrangement, our vocabulary: `plan`, `receipts`, `ledger`, `files`, `appearance`.
- The shell has a DOM contract, not a screenshot: `apps/desktop/test/workbench.test.ts` builds the real
  workbench under happy-dom and asserts the titlebar, the 240px start width and 136–640 clamp, the
  keyboard resize and its persistence, the sidebar and panel toggles, the five panes, the composer
  region order, Enter-to-send, and that the appearance pane lists all eight themes.
- Pixel verification is still unproven in this environment (no headless browser): the DOM, HTTP
  contract and bundle are verified; the rendered image is not.
