# ADR 0001: Theme registry, reading face, and motion vocabulary

- Status: accepted
- Date: 2026-11-08
- Deciders: owner (theme colors, serif direction), implementer (derived tokens, motion encoding)
- Supersedes: the three-theme and two-font statements in `DESIGN.md` 3 and 4

## Context

`DESIGN.md` specified one dark theme ("Base"), a Graphite theme, a Paper theme, and high contrast; it
pinned IBM Plex Sans and JetBrains Mono, and allowed no other face. The owner then supplied six named
themes with exact values for both dark and light, and asked for a serif in the spirit of the reading face
used by Anthropic's product. Those are rule changes, so they need a record and a re-test of the
accessibility floors.

Constraints that did not change: `tokens.css` is the only file allowed to hold raw color (`RULES` 36),
no gradients, shadows, glass, pills, or overshoot easing, no CDN, no new dependency without a license
and a pinned version, and every theme must clear the contrast floors in `DESIGN.md` 11.

## Decision 1: six themes, two modes, one token contract

The registry is `lunar-ash` (default), `moon`, `jupiter`, `mars`, `uranus`, `mercury`, each authored in
`dark` and `light`. Every theme defines the same 23 tokens, so a component never branches on theme.

Owner-supplied values are used verbatim for `--bg`, `--s1`, `--s2`, `--fg`, `--fg-dim`, `--line`,
`--btn`, and `--accent`. `moon` is the OpenCode AMOLED neutral. High contrast is no longer a theme; it
is `data-contrast="high"`, which remaps semantic tokens onto each other and therefore works in all six
themes without inventing a seventh palette.

Owner values that were missing or unusable, and what was done instead:

| Item | Problem | Decision |
| --- | --- | --- |
| Mercury accent | message was truncated before the value | `#9e9a93` (warm silver, sits between `--fg-dim` and `--line-strong`) |
| Mercury light mode | not supplied | derived on the same elevation steps as the other light modes |
| `--co-think` / `--co-work` | one Space pair cannot serve six palettes | per-theme pair, always one warm and one cool tint, so the two Spaces stay distinguishable inside each theme |
| `--attn` / `--danger` | the amber and red that read on black fail 3:1 on the light backgrounds | per-mode calibration (darker amber and rust in light mode) |
| `--diff-add` / `--diff-del` | not supplied | muted fills per theme, checked so body text stays above 4.5:1 on them |
| `--accent` on light | Jupiter 2.23, Mars 2.70, Uranus 1.84, Mercury 2.66 against the page | kept as a fill (selection, focus bloom) and added `--accent-ink`, the same hue pushed past 3:1, for every glyph and text use |
| `--btn-fg` on Mercury light | `#faf9f7` on `#8a8580` measured 3.47 | dark ink on the graphite button, as in its dark mode (5.38) |
| `--line-strong` | 1.49 on Lunar Ash dark, 1.47 on Moon dark | lifted to `#303034` and `#363636` to clear the 1.5 floor for a control border |

Nothing was lowered. Every derived value is listed in `apps/desktop/src/renderer/tokens.css` next to the
token it supports, and the report prints the measured ratio for all 12 variants.

## Decision 2: a reading face, vendored, with a switch

Anthropic's serif is Tiempos Text (Klim), which is proprietary. The closest OFL faces with an optical
size axis are Source Serif 4 (Adobe) and Newsreader (Production Type); Instrument Serif is included as a
display alternative. All three are vendored as woff2 under `apps/desktop/src/renderer/fonts/` with their
OFL notices and SHA-256 digests in `MANIFEST.json`. `data-serif` switches `--font-serif`; the default is
Source Serif 4.

The serif is used for titles (`.t-title-serif`, `.t-section-serif`) and long-form reading (`.prose` at
17px). Chrome, controls, and labels stay in IBM Plex Sans; anything a machine counts stays in JetBrains
Mono with tabular numerals. That keeps the "serif everywhere" tell out and keeps the interface dense.

A fifth size token, `--fs-read: 17px`, was added. Four sizes cannot carry a reading face: 15px serif at
`--lh-read` is too tight for a long answer, and jumping to the 20px title inside a conversation breaks
the row rhythm.

## Decision 3: motion is a table, not a feeling

`motion.ts` holds the thirteen moments as data (`TRANSITIONS`), and a test enforces the limits: transform
and opacity only, one easing curve, nothing over 300ms except the two ambient loops, a stated
reduced-motion behaviour per moment. Components use token durations, so a 500ms fade cannot creep in.

The Thinking shimmer is implemented as a per-character opacity step instead of a mask sweep. A mask needs
`linear-gradient()`, which `scripts/slop-scan.mjs` bans outright; the stepped version reads the same at
11px, costs no mask layer, and needs no rule change.

## Decision 4: state vocabulary is typed, glyphs are code

The fifteen states from `DESIGN.md` 5 live in `states.ts` with label, reason, tone, live-region
politeness, and a 16px-grid SVG glyph drawn with `currentColor`. There is no icon font, no sprite, and no
network request. Terminal states may not declare motion; a test fails if one does.

## License and provenance

| Package | Version | Family | License | Vendored file |
| --- | --- | --- | --- | --- |
| `@fontsource/ibm-plex-sans` | 5.3.0 | IBM Plex Sans 400/500/600 + 400i | OFL-1.1 | `ibm-plex-sans-*.woff2` |
| `@fontsource-variable/jetbrains-mono` | 5.3.0 | JetBrains Mono (variable) | OFL-1.1 | `jetbrains-mono-var.woff2` |
| `@fontsource-variable/source-serif-4` | 5.3.1 | Source Serif 4 (opsz 8-60) | OFL-1.1 | `source-serif-4-opsz*.woff2` |
| `@fontsource-variable/newsreader` | 5.3.0 | Newsreader (opsz 6-72) | OFL-1.1 | `newsreader-opsz*.woff2` |
| `@fontsource/instrument-serif` | 5.3.0 | Instrument Serif 400 | OFL-1.1 | `instrument-serif-400.woff2` |

These are assets, not runtime dependencies: nothing is imported at runtime and `package.json` is
unchanged apart from scripts. `npm run fonts:vendor` re-fetches the pinned versions and rewrites
`MANIFEST.json`; a test fails if a binary's digest no longer matches its manifest entry. Total weight is
732 KB, all Latin subset, all local.

## Consequences

- `DESIGN.md` 3, 4, and 6 are rewritten to match; they no longer describe themes or fonts that do not exist.
- Adding a theme means: values in `tokens.css`, an entry in `THEMES`, and `npm run design:report`. The
  contract test and the drift test both fail until all three are done.
- Old saved preferences degrade per field (`coerceChoice`), so a build that shipped "graphite" does not
  throw on upgrade.
- Risk accepted: six themes means six palettes to keep honest. The contrast report and its test are the
  mitigation, not a promise.
- Still not built: the actual Electron shell, React components, and the Playwright run-through. This ADR
  covers tokens, type, motion, loaders, and the preview only.

## Verification

`npm run verify` passes: typecheck, Biome, 90 tests (28 new in `apps/desktop/test/design-system.test.ts`),
`design:report` with all contrast floors met across 12 variants, and a clean slop scan.

## Alternatives rejected

- **Keep three themes and bolt the six on as "palettes".** Duplicates the token contract and leaves
  components branching on theme, which is exactly what the token layer exists to prevent.
- **Use a webfont CDN for the serif.** Banned by `STACK.md`; also makes the app depend on the network to
  render its own interface.
- **Licence Tiempos or Styrene.** Not open, not bundleable, and a paid licence is a dependency decision
  the owner has to make explicitly.
- **Allow `linear-gradient` for the shimmer mask.** Weakens a CI rule for one effect; the stepped opacity
  costs nothing and keeps the scanner as strict as it was.
- **A seventh "high contrast" theme.** Multiplies the matrix; a modifier that remaps semantics covers all
  six palettes with no new values.
