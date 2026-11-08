/* Measures every theme and mode, then emits the single JSON the preview renders from.
 * Run: npm run design:report   (fails the build when a contrast floor is missed) */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRAST_FLOORS, contrastOf } from '../apps/desktop/src/renderer/color.ts';
import { TRANSITIONS } from '../apps/desktop/src/renderer/motion.ts';
import { STATES, STATE_IDS, glyph } from '../apps/desktop/src/renderer/states.ts';
import {
  MODES,
  SERIFS,
  THEMES,
  type Mode,
  type ThemeChoice,
  type ThemeId,
  resolvedPalette,
  resolveTokens,
} from '../apps/desktop/src/renderer/theme.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
export const TOKENS_PATH = join(root, 'apps/desktop/src/renderer/tokens.css');
export const FONTS_MANIFEST = join(root, 'apps/desktop/src/renderer/fonts/MANIFEST.json');
export const REPORT_PATH = join(root, 'apps/desktop/src/preview/design-data.json');

export type FloorRow = { token: string; on: string; ratio: number; min: number; pass: boolean; why: string };

export type Variant = {
  theme: ThemeId;
  label: string;
  blurb: string;
  mode: Mode;
  tokens: Record<string, string>;
  floors: FloorRow[];
};

export type DesignData = {
  source: string;
  themes: { id: ThemeId; label: string; blurb: string }[];
  serifs: string[];
  variants: Variant[];
  states: {
    id: string;
    label: string;
    reason: string;
    tone: string;
    className: string;
    terminal: boolean;
    live: string;
    glyph: string;
  }[];
  transitions: typeof TRANSITIONS;
  fonts: { family: string; out: string; version: string; pkg: string }[];
  failures: FloorRow[];
};

export function buildReport(css: string, modes: readonly Mode[] = MODES): { variants: Variant[]; failures: FloorRow[] } {
  const variants: Variant[] = [];
  const failures: FloorRow[] = [];
  for (const theme of THEMES) {
    for (const mode of modes) {
      const choice: ThemeChoice = { theme: theme.id, mode, serif: 'source-serif', highContrast: false };
      const resolved = resolvedPalette(resolveTokens(css, choice));
      const floors: FloorRow[] = [];
      for (const floor of CONTRAST_FLOORS) {
        const front = resolved.get(floor.from);
        for (const on of floor.on) {
          const back = resolved.get(on);
          if (!front || !back) continue;
          const ratio = Number((contrastOf(front, back) ?? 0).toFixed(2));
          const row = { token: floor.from, on, ratio, min: floor.min, pass: ratio >= floor.min, why: floor.why };
          floors.push(row);
          if (!row.pass) failures.push(row);
        }
      }
      variants.push({
        theme: theme.id,
        label: theme.label,
        blurb: theme.blurb,
        mode,
        tokens: Object.fromEntries(resolved),
        floors,
      });
    }
  }
  return { variants, failures };
}

export function buildDesignData(css: string): DesignData {
  const { variants, failures } = buildReport(css);
  const fonts = JSON.parse(readFileSync(FONTS_MANIFEST, 'utf8')) as { out: string; pkg: string; version: string }[];
  return {
    source: 'apps/desktop/src/renderer/tokens.css',
    themes: THEMES.map((t) => ({ id: t.id, label: t.label, blurb: t.blurb })),
    serifs: [...SERIFS],
    variants,
    states: STATE_IDS.map((id) => ({
      id,
      label: STATES[id].label,
      reason: STATES[id].reason,
      tone: STATES[id].tone,
      className: STATES[id].className,
      terminal: STATES[id].terminal,
      live: STATES[id].live,
      glyph: glyph(id),
    })),
    transitions: TRANSITIONS,
    fonts: fonts.map((f) => ({
      family: f.out.replace(/-\d.*$|-var.*$|-opsz.*$/, ''),
      out: f.out,
      version: f.version,
      pkg: f.pkg,
    })),
    failures,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const css = readFileSync(TOKENS_PATH, 'utf8');
  const data = buildDesignData(css);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`design:report ${data.variants.length} theme/mode variants, ${data.states.length} states, ${data.transitions.length} motion moments`);
  for (const f of data.failures) console.error(`  ${f.token} on ${f.on}: ${f.ratio} < ${f.min} (${f.why})`);
  console.log(data.failures.length ? `design:report ${data.failures.length} floor(s) missed` : 'design:report all contrast floors met');
  process.exit(data.failures.length ? 1 : 0);
}
