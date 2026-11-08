# ADR 0002: The palette set stays; AMOLED is imported from UUI

- Status: accepted (supersedes the two-theme decision of the same number, 2026-11-08)
- Date: 2026-11-08
- Deciders: owner
- Supersedes in part: ADR 0001 (theme registry)

## Context

ADR 0001 shipped six palettes that came from a reference interface: Lunar Ash, Moon, Jupiter, Mars,
Uranus, Mercury. In the first pass of this slice the owner asked to keep only AMOLED, and a two-theme
registry was written (Anvil + Moon) with the other four deleted. The owner then corrected the
instruction: the palettes were to stay — Mars, Uranus, Mercury, Jupiter "and all of them" — and the
source interface turned out to be a real, public repository (`Erealunetra/UUI`), so its theme set was
also available to read rather than guess at.

This ADR records both the attempt and the reversal, because the reasoning that produced the deletion is
still the reasoning that has to be answered: a product that wears another product's palette is borrowed,
not branded.

## Decision

The registry is eight themes, each in a dark and a light mode (16 measured variants):

| Theme | Source | Note |
| --- | --- | --- |
| **Lunar Ash** (default) | owner palette | AMOLED soft. Cool ash on near-black. |
| **Anvil** | SelfImpulse | House palette. Ink-graphite canvas, steel accent, chalk/slate Space tints. |
| **Moon** | owner palette | True AMOLED, pure black, neutral. |
| **Jupiter** | owner palette | Warm sepia and brass. |
| **Mars** | owner palette | Rust and dust. |
| **Uranus** | owner palette | Deep teal, cold and low glare. |
| **Mercury** | owner palette | Warm graphite. |
| **AMOLED** | **imported from UUI** (`src/theme/themes/amoled.json`) | The only UUI palette carried across. |

Nothing named "removed" is removed. The six owner palettes are restored with the values they had, and
`anvil` remains the house theme.

### What "imported from UUI" means precisely

UUI's theme file supplies a ten-key palette per mode: `neutral, ink, primary, accent, success, warning,
error, info, diffAdd, diffDelete`. Our contract is 23 tokens, so the palette is mapped and the surface
steps are derived:

| our token | from UUI | value (dark) | value (light) |
| --- | --- | --- | --- |
| `--bg` | `neutral` | `#000000` | `#f0f0f0` |
| `--s1` / `--s2` | derived steps | `#0a0a0a` / `#121212` | `#ffffff` / `#e4e4e4` |
| `--line` / `--line-strong` | derived hairlines | `#242424` / `#3d3d3d` | `#cfcfcf` / `#a6a6a6` |
| `--fg` | `ink` | `#ffffff` | `#0a0a0a` |
| `--fg-dim` / `--fg-faint` | derived from `ink` | `#a8a8a8` / `#767676` | `#4a4a4a` / `#666666` |
| `--accent` / `--accent-ink` | `primary` | `#b388ff` / `#b388ff` | `#6200ff` / `#5a00e8` |
| `--btn` / `--btn-fg` | `ink` / `neutral` | `#ffffff` / `#000000` | `#0a0a0a` / `#f0f0f0` |
| `--co-think` | `primary` | `#b388ff` | `#5a00e8` |
| `--co-work` | `info` | `#18ffff` | `#005f8f` (darkened from `#00b0ff`) |
| `--attn` | `warning` | `#ffea00` | `#7a5000` (darkened from `#ffab00`) |
| `--danger` | `error` | `#ff5252` (lifted from `#ff1744`) | `#b3122f` (darkened from `#ff1744`) |

Three of UUI's light values fail our floors on their own `#f0f0f0` page: `success #00e676` is 1.4:1,
`warning #ffab00` is 1.5:1, `error #ff1744` is 3.4:1 against the 4.5:1 a state glyph needs. The raw
values are recorded above rather than quietly replaced, and the derived steps are what ship.
`npm run design:report` measures all 16 variants; every floor passes.

UUI's other 35 palettes are not imported. One import proves the path and keeps the promise that the
borrowed set is deliberate; 35 more would be 35 unmeasured surface derivations wearing someone else's
names.

### Why the reversal does not dissolve the branding question

The deletion argued that palettes alone cannot carry identity. That argument stands; the conclusion drawn
from it did not. Identity is carried by, and measured as:

- **Type.** Source Serif 4 (with Newsreader and Instrument Serif selectable) for titles and answers, sans
  for chrome, mono for anything counted.
- **The mark.** `//impulse` in the sidebar brand row, the preview footer, and the signature line written
  into any file a turn produces.
- **The impulse line.** A 1px rule down the Thread that is still by default and breathes only while a
  turn is genuinely active — a state display, not an ornament.
- **Voice as code.** `packages/voice` holds sanctioned strings and a list of words the product does not
  use; a test fails if a status line contains one.

So the palettes are a wardrobe, not a face. The face is the serif line, the mark, the impulse line, and
the refusal to lie about state.

## Consequences

- `tokens.css` carries 8 themes × 2 modes; `THEMES` must track it and the drift test enforces that.
- `design:report` now reports 16 variants; the build fails if any one of them misses a floor.
- The appearance pane lists all eight, because a theme nobody can select is a theme nobody has.
- Adding a ninth theme means 23 tokens in two modes and a passing report — the cost is explicit.
