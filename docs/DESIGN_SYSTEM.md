# Design system: how to use it

The workbench in `apps/desktop/src/app` renders a live Thread from `apps/server`; the classes below are
what it uses. Open `npm run app` to see them against real state, and `npm run preview` to see them in
isolation with every theme and face side by side.

Everything visual is in `apps/desktop/src/renderer/`. Values live in `tokens.css`; nothing else may hold a
raw color (`RULES` 36, enforced by `npm run slop`). The reasoning is in `docs/adr/0001`.

```
apps/desktop/src/renderer/
  tokens.css     raw values: 6 themes x dark/light, type, space, motion, z
  fonts.css      @font-face for the vendored OFL binaries
  fonts/         woff2 + OFL notices + MANIFEST.json (sha256)
  base.css       reset, focus ring, .panel .row .btn .chip
  type.css       .t-meta .t-body .t-section .t-title .prose .mono .num .timer
  motion.css     transitions, keyframes, loaders, skeletons, commit wipe, receipt
  states.css     state rows, glyph tones, sub-agent rows, source chips, diff fills
  color.ts       WCAG math + the contrast floors
  theme.ts       theme registry, token resolver, preference persistence
  states.ts      15 states with glyph, label, reason, aria
  motion.ts      the motion table + reduced motion + pause when hidden
apps/desktop/src/preview/   the live preview (npm run preview)
```

## Apply a theme

```ts
import { applyTheme, readChoice, writeChoice } from './renderer/theme';

const choice = readChoice(localStorage);           // degrades per field on old values
applyTheme(document.documentElement, choice);      // sets data-theme, data-mode, data-serif, data-contrast
writeChoice(localStorage, { ...choice, mode: 'light' });
```

Attributes only, so switching a theme needs no React re-render. `data-theme` is one of `lunar-ash`,
`moon`, `jupiter`, `mars`, `uranus`, `mercury`; `data-mode` is `dark` or `light`.

## Render a state

```html
<div class="state-row state-needs-approval">
  <span class="glyph tone-wait" aria-hidden="true"><!-- glyph('needs-approval') --></span>
  <span class="state-label">needs approval</span>
  <span class="state-reason">Waiting for a human signature on the exact effect.</span>
</div>
```

```ts
import { STATES, glyph, stateRow } from './renderer/states';

const row = stateRow('needs-approval');
// { label, reason, glyph (SVG string), className, toneVar, live, animating }
```

Fifteen states, and a terminal state never carries motion. `live` tells you which live region to announce
into: `assertive` only for states where a human must act.

## Loaders

| Class | Use | Real trigger |
| --- | --- | --- |
| `.thinking` + spans with `--i` | the Thinking label | the model turn actually started |
| `.loader-hairline > i` | indeterminate work (web search) | a query is in flight |
| `.loader-dash` | a page queued for reading | fetch in progress |
| `.skeleton` | content placeholder | only after 300ms of real waiting |
| `.progress > i` with `--value` | determinate progress | a real count, never a guess |
| `.caret` | streaming output | tokens arriving |
| `.commit[data-phase]` | rehearsed becomes real | the commit event, not a timer |
| `.receipt[data-recovery="rolled-back"]` | recovery | a real rollback |

Every one of these is driven by a backend state class. If the state is not real, the loader must not run.

## Motion

Use token durations (`var(--t-micro)`, `var(--t-panel)`) and `var(--ease)`. Only `transform` and
`opacity`. If a new moment is needed, add it to `TRANSITIONS` in `motion.ts` with its reduced-motion
behaviour; the test then holds it to the 300ms ceiling and the two-property rule.

```ts
import { pauseWhenHidden, prefersReducedMotion, staggerDelay } from './renderer/motion';

const dispose = pauseWhenHidden(document, document.documentElement);
const delay = staggerDelay(index); // 0, 40, 80 ... capped at 400ms
```

## Add a theme

1. Add a `:root[data-theme="name"]` block and its `[data-mode="light"]` block in `tokens.css`, with all
   23 tokens.
2. Add an entry to `THEMES` in `theme.ts`.
3. Add a `data-serif` block only if you are adding a face.
4. Run `npm run design:report`. It fails and names the token if any contrast floor is missed.
5. Run `npm run verify`.

## Commands

| Command | Does |
| --- | --- |
| `npm run preview` | serves `apps/desktop/src` at `/preview/` for the live design preview |
| `npm run app` | builds the workbench and starts the harness at `/app/` on :4180 |
| `npm run build:app` | bundles `src/app/main.ts` into `dist/app/main.js` (esbuild, ADR 0003) |
| `npm run design:report` | measures all 12 variants, writes `preview/design-data.json`, fails on a missed floor |
| `npm run fonts:vendor` | re-fetches the pinned OFL fonts and rewrites `MANIFEST.json` |
| `npm run slop` | fails on gradients, shadows, blur, emoji, overshoot, off-token colors, radius above 6px |
| `npm run verify` | typecheck, lint, tests, design report, slop scan |

## Floors

| Token | On | Minimum |
| --- | --- | --- |
| `fg` | bg, s1, s2 | 7:1 |
| `fg-dim` | bg, s1, s2 | 4.5:1 |
| `fg-faint` | bg, s1 | 3:1 |
| `accent-ink`, `co-think`, `co-work` | bg, s1, s2 | 3:1 |
| `attn`, `danger` | bg, s1 | 3:1 |
| `line` | bg | 1.15:1 |
| `line-strong` | bg | 1.5:1 |
| `btn-fg` | btn | 4.5:1 |
| `fg` | diff-add, diff-del | 4.5:1 |

Measured, not estimated. The numbers in the preview come from the same code the test runs.
