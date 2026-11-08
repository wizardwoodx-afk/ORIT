#!/usr/bin/env node
// Vendors the pinned OFL font binaries into the renderer so nothing loads from a CDN.
// Run: node scripts/vendor-fonts.mjs   (needs network; CI uses the committed files)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FONTS = [
  { pkg: '@fontsource/ibm-plex-sans', version: '5.3.0', file: 'ibm-plex-sans-latin-400-normal.woff2', out: 'ibm-plex-sans-400.woff2' },
  { pkg: '@fontsource/ibm-plex-sans', version: '5.3.0', file: 'ibm-plex-sans-latin-400-italic.woff2', out: 'ibm-plex-sans-400-italic.woff2' },
  { pkg: '@fontsource/ibm-plex-sans', version: '5.3.0', file: 'ibm-plex-sans-latin-500-normal.woff2', out: 'ibm-plex-sans-500.woff2' },
  { pkg: '@fontsource/ibm-plex-sans', version: '5.3.0', file: 'ibm-plex-sans-latin-600-normal.woff2', out: 'ibm-plex-sans-600.woff2' },
  { pkg: '@fontsource-variable/jetbrains-mono', version: '5.3.0', file: 'jetbrains-mono-latin-wght-normal.woff2', out: 'jetbrains-mono-var.woff2' },
  { pkg: '@fontsource-variable/source-serif-4', version: '5.3.1', file: 'source-serif-4-latin-opsz-normal.woff2', out: 'source-serif-4-opsz.woff2' },
  { pkg: '@fontsource-variable/source-serif-4', version: '5.3.1', file: 'source-serif-4-latin-opsz-italic.woff2', out: 'source-serif-4-opsz-italic.woff2' },
  { pkg: '@fontsource-variable/newsreader', version: '5.3.0', file: 'newsreader-latin-opsz-normal.woff2', out: 'newsreader-opsz.woff2' },
  { pkg: '@fontsource-variable/newsreader', version: '5.3.0', file: 'newsreader-latin-opsz-italic.woff2', out: 'newsreader-opsz-italic.woff2' },
  { pkg: '@fontsource/instrument-serif', version: '5.3.0', file: 'instrument-serif-latin-400-normal.woff2', out: 'instrument-serif-400.woff2' },
];

const LICENSE = {
  '@fontsource/ibm-plex-sans': 'IBM-Plex-OFL.txt',
  '@fontsource-variable/jetbrains-mono': 'JetBrains-Mono-OFL.txt',
  '@fontsource-variable/source-serif-4': 'Source-Serif-4-OFL.txt',
  '@fontsource-variable/newsreader': 'Newsreader-OFL.txt',
  '@fontsource/instrument-serif': 'Instrument-Serif-OFL.txt',
};

export const DEST = 'apps/desktop/src/renderer/fonts';

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function vendor(dest = DEST) {
  const work = mkdtempSync(join(tmpdir(), 'fontvendor-'));
  mkdirSync(dest, { recursive: true });
  const seen = new Set();
  for (const f of FONTS) {
    const slug = `${f.pkg.replace(/[@/]/g, '-')}-${f.version}`;
    const unpacked = join(work, slug);
    if (!seen.has(slug)) {
      const tgz = execFileSync('npm', ['pack', `${f.pkg}@${f.version}`, '--silent'], { cwd: work, encoding: 'utf8' })
        .trim()
        .split('\n')
        .pop();
      mkdirSync(unpacked, { recursive: true });
      execFileSync('tar', ['-xzf', join(work, tgz ?? ''), '-C', unpacked]);
      seen.add(slug);
    }
    copyFileSync(join(unpacked, 'package', 'files', f.file), join(dest, f.out));
    const licence = LICENSE[f.pkg];
    if (licence) copyFileSync(join(unpacked, 'package', 'LICENSE'), join(dest, licence));
    console.log(`${f.out}  ${sha256(join(dest, f.out)).slice(0, 16)}`);
  }
  const manifest = FONTS.map((f) => ({ ...f, sha256: sha256(join(dest, f.out)) }));
  writeFileSync(join(dest, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(work, { recursive: true, force: true });
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) vendor();
