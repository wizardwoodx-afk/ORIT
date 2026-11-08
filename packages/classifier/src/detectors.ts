import { type Conf, maxConf } from '@si/core';

const SECRETS: Array<[string, RegExp]> = [
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];
const ASSIGN = /\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b\s*[:=]\s*["']?([A-Za-z0-9_\-/+=]{20,})/gi;
const DIGITS = /\b\d(?:[ -]?\d){11,18}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/; // India PAN shape: weak signal

export function entropy(s: string): number {
  const f = new Map<string, number>();
  for (const ch of s) f.set(ch, (f.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of f.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function luhn(d: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];

/** Verhoeff checksum, used by Aadhaar numbers. */
export function verhoeff(d: string): boolean {
  let c = 0;
  const r = [...d].reverse();
  for (let i = 0; i < r.length; i++) c = (VD[c] as number[])[(VP[i % 8] as number[])[Number(r[i])] as number] as number;
  return c === 0;
}

/** Scans text. Returns flag ids only: matched text is never returned or logged. */
export function scanText(text: string): { flags: string[]; conf: Conf } {
  const flags = new Set<string>();
  let conf: Conf = 'public';
  for (const [id, re] of SECRETS) {
    if (re.test(text)) {
      flags.add(`secret:${id}`);
      conf = 'restricted';
    }
  }
  for (const m of text.matchAll(ASSIGN)) {
    if (entropy(m[1] as string) > 3.5) {
      flags.add('secret:assignment');
      conf = 'restricted';
      break;
    }
  }
  for (const m of text.matchAll(DIGITS)) {
    const d = m[0].replace(/[ -]/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) {
      flags.add('pii:payment-card');
      conf = 'restricted';
      break;
    }
    if (d.length === 12 && /^[2-9]/.test(d) && verhoeff(d)) {
      flags.add('pii:aadhaar');
      conf = 'restricted';
      break;
    }
  }
  if (PAN.test(text)) {
    flags.add('pii:pan-like');
    conf = maxConf(conf, 'confidential');
  }
  if ([...text.matchAll(EMAIL)].length >= 5) {
    flags.add('pii:emails');
    conf = maxConf(conf, 'confidential');
  }
  return { flags: [...flags], conf };
}
