/* Theme registry and token resolution.
 *
 * `tokens.css` is the single source of truth for values. This module is the typed view of it:
 * the registry names the themes, and the resolver lets tests and the preview read a theme's
 * resolved tokens without a browser. Adding a theme means editing both, and the drift test fails
 * if they disagree.
 */

export const THEMES = [
  {
    id: 'lunar-ash',
    label: 'Lunar Ash',
    blurb: 'AMOLED soft. Cool ash greys on true black, the default.',
  },
  { id: 'moon', label: 'Moon', blurb: 'True OpenCode AMOLED. Neutral, no tint.' },
  { id: 'jupiter', label: 'Jupiter', blurb: 'Warm sepia and brass. Desk-lamp dark.' },
  { id: 'mars', label: 'Mars', blurb: 'Rust and dust. Highest thermal warmth.' },
  { id: 'uranus', label: 'Uranus', blurb: 'Deep teal. Cold, clinical, low glare.' },
  { id: 'mercury', label: 'Mercury', blurb: 'Warm graphite. Quiet grey, no chrome.' },
] as const;

export const MODES = ['dark', 'light'] as const;
export const SERIFS = ['source-serif', 'newsreader', 'instrument'] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export type Mode = (typeof MODES)[number];
export type SerifId = (typeof SERIFS)[number];

export const DEFAULT_THEME: ThemeId = 'lunar-ash';
export const DEFAULT_MODE: Mode = 'dark';

/** Every token a theme must define. Missing one is a failing test, not a silent fallback. */
export const THEME_TOKENS = [
  'bg',
  's1',
  's2',
  'line',
  'line-strong',
  'fg',
  'fg-dim',
  'fg-faint',
  'accent',
  'accent-ink',
  'btn',
  'btn-fg',
  'co-think',
  'co-work',
  'attn',
  'danger',
  'diff-add',
  'diff-del',
  'hover',
  'active',
  'selected',
  'scrim',
  'focus',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type TokenMap = Readonly<Record<string, string>>;

export type ThemeChoice = {
  readonly theme: ThemeId;
  readonly mode: Mode;
  readonly serif: SerifId;
  readonly highContrast: boolean;
};

export const DEFAULT_CHOICE: ThemeChoice = {
  theme: DEFAULT_THEME,
  mode: DEFAULT_MODE,
  serif: 'source-serif',
  highContrast: false,
};

export type Block = { readonly selector: string; readonly decls: ReadonlyMap<string, string> };

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Flat parse of a stylesheet: selector -> declarations. At-rule bodies are skipped on purpose;
 *  media queries only restate motion tokens and must not leak into a resolved theme. */
export function parseBlocks(css: string): Block[] {
  const text = stripComments(css);
  const blocks: Block[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < text.length && depth > 0) {
      const ch = text[cursor];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      cursor += 1;
    }
    const body = text.slice(open + 1, cursor - 1);
    if (!selector.startsWith('@')) {
      const decls = new Map<string, string>();
      for (const chunk of body.split(';')) {
        const at = chunk.indexOf(':');
        if (at < 0) continue;
        const name = chunk.slice(0, at).trim();
        const value = chunk.slice(at + 1).trim();
        if (name.startsWith('--') && value.length > 0) decls.set(name.slice(2), value);
      }
      blocks.push({ selector, decls });
    }
    i = cursor;
  }
  return blocks;
}

type Context = { theme: ThemeId; mode: Mode; highContrast: boolean; serif: SerifId };

const ATTR = /^\[(data-[a-z-]+)="([a-z-]+)"\]$/;

/** Matches only the selector grammar this design system uses, and throws on anything else so a
 *  hand-written selector cannot silently escape the token contract. */
export function selectorMatches(selector: string, ctx: Context): boolean {
  return selector.split(',').some((part) => {
    const conditions = part.trim().replace(/^:root/, '').match(/\[[^\]]+\]/g) ?? [];
    if (part.trim().replace(/\[[^\]]+\]/g, '') !== ':root') {
      throw new Error(`unsupported selector in tokens.css: ${part.trim()}`);
    }
    return conditions.every((raw) => {
      const m = ATTR.exec(raw.trim());
      if (!m) throw new Error(`unsupported selector fragment in tokens.css: ${raw}`);
      const [, attr, value] = m;
      switch (attr) {
        case 'data-theme':
          return value === ctx.theme;
        case 'data-mode':
          return value === ctx.mode;
        case 'data-contrast':
          return ctx.highContrast && value === 'high';
        case 'data-serif':
          return value === ctx.serif;
        default:
          throw new Error(`unsupported attribute in tokens.css: ${attr}`);
      }
    });
  });
}

export function resolveTokens(css: string, choice: ThemeChoice): Map<string, string> {
  const ctx: Context = {
    theme: choice.theme,
    mode: choice.mode,
    highContrast: choice.highContrast,
    serif: choice.serif,
  };
  const resolved = new Map<string, string>();
  for (const block of parseBlocks(css)) {
    // The default theme shares the bare `:root` block; a non-default theme must not inherit it twice.
    if (block.selector === ':root' && ctx.theme !== DEFAULT_THEME) {
      for (const [k, v] of block.decls) resolved.set(k, v);
      continue;
    }
    if (selectorMatches(block.selector, ctx)) for (const [k, v] of block.decls) resolved.set(k, v);
  }
  return resolved;
}

/** Resolves `var(--x)` chains down to literal values. Unknown names are returned as-is so the
 *  contrast report can name them instead of crashing. */
export function resolveVars(tokens: ReadonlyMap<string, string>, name: string, depth = 0): string {
  if (depth > 12) throw new Error(`var() cycle at --${name}`);
  const raw = tokens.get(name);
  if (raw === undefined) return `var(--${name})`;
  return raw.replace(/var\(\s*--([a-z][a-z0-9-]*)\s*\)/g, (_all, ref: string) =>
    resolveVars(tokens, ref, depth + 1),
  );
}

export function resolvedPalette(tokens: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of tokens.keys()) out.set(name, resolveVars(tokens, name));
  return out;
}

export type AttrSink = { setAttribute(name: string, value: string): void; removeAttribute?(name: string): void };

/** Applies a choice to the document root. Attributes only, so CSS does the work and no React
 *  re-render is needed when a theme changes. */
export function applyTheme(root: AttrSink, choice: ThemeChoice): void {
  root.setAttribute('data-theme', choice.theme);
  root.setAttribute('data-mode', choice.mode);
  root.setAttribute('data-serif', choice.serif);
  if (choice.highContrast) root.setAttribute('data-contrast', 'high');
  else root.removeAttribute?.('data-contrast');
}

export type KeyValueStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const STORAGE_KEY = 'selfimpulse.theme';

export function readChoice(store: KeyValueStore): ThemeChoice {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_CHOICE;
  try {
    const parsed: unknown = JSON.parse(raw);
    return coerceChoice(parsed);
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function writeChoice(store: KeyValueStore, choice: ThemeChoice): void {
  store.setItem(STORAGE_KEY, JSON.stringify(choice));
}

/** Parsing is a boundary (RULES 19): a stored value from an older build degrades to the default
 *  per field instead of throwing away the whole preference. */
export function coerceChoice(value: unknown): ThemeChoice {
  if (typeof value !== 'object' || value === null) return DEFAULT_CHOICE;
  const record = value as Record<string, unknown>;
  const theme = THEMES.find((t) => t.id === record.theme)?.id ?? DEFAULT_THEME;
  const mode = MODES.find((m) => m === record.mode) ?? DEFAULT_MODE;
  const serif = SERIFS.find((s) => s === record.serif) ?? DEFAULT_CHOICE.serif;
  return { theme, mode, serif, highContrast: record.highContrast === true };
}
