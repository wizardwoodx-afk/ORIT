# ADR 0002: SelfImpulse signature themes; reference palettes removed

- Status: accepted
- Date: 2026-11-08
- Deciders: owner
- Supersedes in part: ADR 0001 (theme registry)

## Context

ADR 0001 shipped six palettes that came from a reference interface: Lunar Ash, Moon, Jupiter, Mars,
Uranus, Mercury. The owner's instruction for this pass was specific: use the layout and placements of
the reference workbench, remove its theme colors, and keep the AMOLED theme. A product that wears another
product's palette is not branded, it is borrowed.

## Decision

The registry is now two themes:

| Theme | Modes | Why it exists |
| --- | --- | --- |
| **Anvil** (default) | dark, light | SelfImpulse's own. Ink-graphite canvas, steel accent, chalk and slate Space tints. The light mode is the "paper for bright rooms" mode. |
| **Moon** | dark, light | Retained by owner instruction. True AMOLED, pure black, neutral. |

Removed: `lunar-ash`, `jupiter`, `mars`, `uranus`, `mercury`. Their values are gone from `tokens.css`,
from `THEMES`, and from the report. Nothing was renamed to hide the removal.

What replaced the "brand color" job the removed palettes did:

- **Type is the identity.** The reading face (Source Serif 4, with Newsreader and Instrument Serif
  selectable) carries titles and answers; the sans carries chrome; the mono carries anything counted.
  A competitor's green dot is not what makes this product recognisable; the serif line and the
  `//impulse` mark are.
- **The mark.** `//impulse` appears in the app header, the footer of the design preview, and as the
  signature line written into any file a turn produces.
- **The impulse line.** A 1px rule down the left of the Thread that is still by default and breathes
  only while a turn is genuinely active. It is a state display, not an ornament.
- **Voice as code.** `packages/voice` holds the sanctioned strings and a list of words the product does
  not use. A test fails if a status line contains one.

Anvil tokens (dark): `--bg #0a0a0b`, `--s1 #111113`, `--s2 #18181b`, `--fg #ecece8`, `--fg-dim #a6a6a1`,
`--accent/--accent-ink #a9b4c2`, `--co-think #c8bfae`, `--co-work #7e9aa8`, `--attn #e0b04f`,
`--danger #e0605a`.
Anvil tokens (light): `--bg #f5f4f1`, `--s1 #ffffff`, `--s2 #ecebe7`, `--fg #191a1c`, `--fg-dim #575a5e`,
`--accent #a9b4c2` (fill only), `--accent-ink #4c5f72` (light mode needs the darker form to clear 3:1).

## Consequences

- Four variants instead of twelve. Same floors, same test, fewer palettes to keep honest.
- Anyone who preferred Jupiter or Mars is out of luck by owner decision, not by accident. Restoring one
  is a two-block edit in `tokens.css` plus a registry entry and `npm run design:report`.
- The high-contrast modifier still remaps semantics, so it works across both themes without new values.
- Moon keeps its light mode for parity; an AMOLED theme is dark by nature, but a half-defined theme is
  worse than an unused mode.

## Verification

`npm run verify` passes: typecheck, Biome, 100 tests, `design:report` with all contrast floors met
across 4 variants, clean slop scan, and the app bundle builds.
