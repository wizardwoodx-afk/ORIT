import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildDesignData, buildReport, REPORT_PATH } from '../../../scripts/design-report.mts';
import { CONTRAST_FLOORS, contrastOf, parseHex } from '../src/renderer/color';
import { MAX_DURATION_MS, EASING, TRANSITIONS, staggerDelay } from '../src/renderer/motion';
import { STATES, STATE_IDS, glyph, stateRow } from '../src/renderer/states';
import {
  DEFAULT_CHOICE,
  MODES,
  SERIFS,
  THEMES,
  THEME_TOKENS,
  coerceChoice,
  resolveTokens,
  resolvedPalette,
  selectorMatches,
  applyTheme,
  readChoice,
  writeChoice,
  type KeyValueStore,
  type ThemeChoice,
} from '../src/renderer/theme';

const here = dirname(fileURLToPath(import.meta.url));
const renderer = join(here, '../src/renderer');
const tokensCss = readFileSync(join(renderer, 'tokens.css'), 'utf8');

const allChoices: ThemeChoice[] = THEMES.flatMap((t) =>
  MODES.map((mode) => ({ theme: t.id, mode, serif: 'source-serif' as const, highContrast: false })),
);

describe('token contract', () => {
  it('defines every theme token in every theme and mode', () => {
    for (const choice of allChoices) {
      const tokens = resolveTokens(tokensCss, choice);
      for (const token of THEME_TOKENS) {
        expect(tokens.get(token), `${choice.theme}/${choice.mode} is missing --${token}`).toBeTruthy();
      }
    }
  });

  it('resolves every color token to a literal color, never a dangling var()', () => {
    for (const choice of allChoices) {
      const palette = resolvedPalette(resolveTokens(tokensCss, choice));
      for (const token of THEME_TOKENS) {
        const value = palette.get(token) ?? '';
        expect(parseHex(value), `${choice.theme}/${choice.mode} --${token} = ${value}`).not.toBeNull();
      }
    }
  });

  it('has one registry entry per theme block in CSS', () => {
    for (const theme of THEMES) {
      expect(tokensCss).toContain(`[data-theme="${theme.id}"]`);
    }
    expect(THEMES).toHaveLength(8);
  });

  it('rejects a selector outside the supported grammar', () => {
    expect(() => selectorMatches(':root:hover[data-theme="moon"]', { ...DEFAULT_CHOICE, highContrast: false })).toThrow();
    expect(selectorMatches(':root[data-theme="moon"]', { ...DEFAULT_CHOICE, theme: 'moon' })).toBe(true);
    expect(selectorMatches(':root[data-theme="moon"]', DEFAULT_CHOICE)).toBe(false);
  });

  it('keeps the light and dark blocks distinct', () => {
    const dark = resolveTokens(tokensCss, { ...DEFAULT_CHOICE, theme: 'anvil', mode: 'dark' });
    const light = resolveTokens(tokensCss, { ...DEFAULT_CHOICE, theme: 'anvil', mode: 'light' });
    expect(dark.get('bg')).not.toBe(light.get('bg'));
    expect(parseHex(light.get('bg') ?? '')).not.toBeNull();
  });
});

describe('contrast floors', () => {
  it('passes every floor in every theme and mode', () => {
    const report = buildReport(tokensCss);
    expect(report.variants).toHaveLength(THEMES.length * MODES.length);
    expect(report.failures).toEqual([]);
  });

  it('checks the pairs it claims to check', () => {
    expect(CONTRAST_FLOORS.length).toBeGreaterThanOrEqual(10);
    const report = buildReport(tokensCss);
    for (const variant of report.variants) {
      expect(variant.floors.length).toBe(CONTRAST_FLOORS.reduce((n, f) => n + f.on.length, 0));
    }
  });

  it('keeps the committed design data in step with the tokens', () => {
    const committed: unknown = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildDesignData(tokensCss))));
  });

  it('is measurably better than the palette it replaced', () => {
    // The old spec's verdigris on black is a useful reference point: state color must be readable.
    expect(contrastOf('#5fa38b', '#000000')).toBeGreaterThan(4.5);
    expect(contrastOf('#e8ebf0', '#000000')).toBeGreaterThan(15);
  });
});

describe('state vocabulary', () => {
  it('has the fifteen documented states, unique', () => {
    expect(STATE_IDS).toHaveLength(15);
    expect(new Set(STATE_IDS).size).toBe(15);
    expect([...STATE_IDS]).toEqual(Object.keys(STATES));
  });

  it('gives every state a label, a reason, and a 16px glyph', () => {
    for (const id of STATE_IDS) {
      const meta = STATES[id];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.reason.length).toBeGreaterThan(8);
      expect(meta.className).toBe(`state-${id}`);
      expect(glyph(id)).toContain('viewBox="0 0 16 16"');
      expect(glyph(id, 20)).toContain('width="20"');
      expect(glyph(id)).toContain('stroke="currentColor"');
    }
  });

  it('never animates a terminal state', () => {
    for (const id of STATE_IDS) {
      if (!STATES[id].terminal) continue;
      expect(STATES[id].motion).toBe('none');
      expect(stateRow(id).animating).toBe(false);
    }
  });

  it('keeps messages polite unless a human must act', () => {
    expect(STATES['needs-approval'].live).toBe('assertive');
    expect(STATES.failed.live).toBe('assertive');
    expect(STATES.running.live).toBe('off');
  });

  it('contains no emoji in any label, reason, or glyph', () => {
    const pictographic = /\p{Extended_Pictographic}/u;
    for (const id of STATE_IDS) {
      expect(pictographic.test(STATES[id].label)).toBe(false);
      expect(pictographic.test(STATES[id].reason)).toBe(false);
      expect(pictographic.test(glyph(id))).toBe(false);
    }
  });
});

describe('motion rules', () => {
  it('never runs a transition longer than 300ms, except the ambient loops', () => {
    const ambient = new Set(['thinking-shimmer', 'search-bar', 'reading-dash', 'glyph-arc']);
    for (const spec of TRANSITIONS) {
      if (ambient.has(spec.moment)) continue;
      expect(spec.ms, `${spec.moment} is over the limit`).toBeLessThanOrEqual(MAX_DURATION_MS);
    }
  });

  it('animates only transform and opacity', () => {
    for (const spec of TRANSITIONS) expect(['transform', 'opacity']).toContain(spec.property);
  });

  it('uses one easing curve and no bounce', () => {
    for (const spec of TRANSITIONS) {
      expect(spec.easing).toBe(EASING);
      expect(spec.easing).not.toMatch(/bounce|spring/i);
    }
  });

  it('describes what reduced motion does for every moment', () => {
    for (const spec of TRANSITIONS) expect(spec.reducedMotion.length).toBeGreaterThan(3);
  });

  it('caps stagger so a long source list cannot crawl', () => {
    expect(staggerDelay(0)).toBe('0ms');
    expect(staggerDelay(3)).toBe('120ms');
    expect(staggerDelay(999)).toBe('400ms');
  });

  it('declares a reduced-motion branch in CSS for every ambient loop', () => {
    const css = readFileSync(join(renderer, 'motion.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    for (const selector of ['.thinking > span', '.loader-hairline > i', '.loader-dash', '.caret']) {
      expect(css).toContain(selector);
    }
    expect(css).toContain('.is-window-hidden');
  });
});

describe('theme choice', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const kv: KeyValueStore = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    };
    const choice: ThemeChoice = { theme: 'moon', mode: 'light', serif: 'newsreader', highContrast: true };
    writeChoice(kv, choice);
    expect(readChoice(kv)).toEqual(choice);
  });

  it('degrades an unknown stored theme field by field instead of failing', () => {
    expect(coerceChoice({ theme: 'neptune', mode: 'light', serif: 'werid', highContrast: 'yes' })).toEqual({
      theme: DEFAULT_CHOICE.theme,
      mode: 'light',
      serif: DEFAULT_CHOICE.serif,
      highContrast: false,
    });
    expect(coerceChoice(null)).toEqual(DEFAULT_CHOICE);
  });

  it('writes attributes, and clears high contrast when it is off', () => {
    const set = new Map<string, string>();
    const root = {
      setAttribute: (k: string, v: string) => void set.set(k, v),
      removeAttribute: (k: string) => void set.delete(k),
    };
    applyTheme(root, { theme: 'moon', mode: 'dark', serif: 'instrument', highContrast: true });
    expect(set.get('data-theme')).toBe('moon');
    expect(set.get('data-contrast')).toBe('high');
    applyTheme(root, { theme: 'moon', mode: 'dark', serif: 'instrument', highContrast: false });
    expect(set.has('data-contrast')).toBe(false);
  });

  it('offers three vendored serif faces', () => {
    expect(SERIFS).toHaveLength(3);
    for (const serif of SERIFS) expect(tokensCss).toContain(`[data-serif="${serif}"]`);
  });
});

describe('vendored fonts', () => {
  const manifest: { file: string; out: string; sha256: string; pkg: string; version: string }[] = JSON.parse(
    readFileSync(join(renderer, 'fonts/MANIFEST.json'), 'utf8'),
  );

  it('ships every pinned binary with a matching digest', () => {
    for (const entry of manifest) {
      const path = join(renderer, 'fonts', entry.out);
      expect(existsSync(path), `${entry.out} is missing`).toBe(true);
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
      expect(digest, `${entry.out} changed without a manifest update`).toBe(entry.sha256);
    }
  });

  it('declares a local @font-face for every vendored face and no remote URL', () => {
    const fontsCss = readFileSync(join(renderer, 'fonts.css'), 'utf8');
    expect(fontsCss).not.toMatch(/https?:/);
    for (const entry of manifest) expect(fontsCss).toContain(`./fonts/${entry.out}`);
  });

  it('keeps the OFL notice for every family', () => {
    for (const notice of [
      'IBM-Plex-OFL.txt',
      'JetBrains-Mono-OFL.txt',
      'Source-Serif-4-OFL.txt',
      'Newsreader-OFL.txt',
      'Instrument-Serif-OFL.txt',
    ]) {
      expect(existsSync(join(renderer, 'fonts', notice)), `${notice} is missing`).toBe(true);
    }
  });

  it('never references a banned default font family', () => {
    const banned = /\b(Inter|Roboto|Geist|Poppins|Montserrat|Space Grotesk)\b/i;
    for (const file of ['tokens.css', 'type.css', 'fonts.css']) {
      expect(banned.test(readFileSync(join(renderer, file), 'utf8'))).toBe(false);
    }
  });
});
