#!/usr/bin/env node
// UI anti-slop scanner. Fails the build on the documented "AI look" tells and on any color outside tokens.css.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const RULES = [
  ['gradient', /(linear|radial|conic)-gradient\(/i, 'gradients are not allowed'],
  ['shadow', /(box-shadow|text-shadow)\s*:\s*(?!none)|drop-shadow\(/i, 'shadows are not allowed (use 1px borders and luminance steps)'],
  ['glass', /backdrop-filter|filter\s*:\s*blur\(|blur\(\d/i, 'blur and glass effects are not allowed'],
  ['font', /font-family[^;{}]*\b(Inter|Roboto|Geist|Poppins|Montserrat|Space Grotesk)\b/i, 'default AI-look fonts are not allowed'],
  ['emoji', /\p{Extended_Pictographic}/u, 'emoji are not allowed in UI source'],
  ['bounce', /cubic-bezier\([^)]*-\d|spring\(|bounce/i, 'no bounce or overshoot easing'],
];

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : [p];
  });

export function scan(dir) {
  const files = walk(dir).filter((f) => ['.css', '.ts', '.tsx', '.html'].includes(extname(f)));
  const tokens = files.find((f) => basename(f) === 'tokens.css');
  const allowed = new Set(tokens ? [...readFileSync(tokens, 'utf8').matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase()) : []);
  const findings = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      for (const [id, re, msg] of RULES) if (re.test(line)) findings.push({ file: f, line: i + 1, rule: id, msg });
      const r = line.match(/border-radius\s*:\s*(\d+)px/i);
      if (r && Number(r[1]) > 6) findings.push({ file: f, line: i + 1, rule: 'radius', msg: 'radius above 6px' });
      if (f !== tokens) for (const h of line.matchAll(/#[0-9a-f]{3,8}\b/gi)) if (!allowed.has(h[0].toLowerCase())) findings.push({ file: f, line: i + 1, rule: 'color', msg: `color ${h[0]} is not a token` });
    });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = scan(process.argv[2] ?? 'apps/desktop/src');
  for (const x of out) console.error(`${x.file}:${x.line} [${x.rule}] ${x.msg}`);
  console.log(out.length ? `slop-scan: ${out.length} finding(s)` : 'slop-scan: clean');
  process.exit(out.length ? 1 : 0);
}
