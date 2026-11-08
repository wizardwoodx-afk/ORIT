import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { type Conf, confRank, maxConf, sha256hex } from '@si/core';
import { scanText } from './detectors.ts';

export type Kind =
  | 'source' | 'config' | 'doc' | 'data' | 'credential' | 'lockfile'
  | 'generated' | 'vendored' | 'archive' | 'media' | 'binary' | 'unknown';

export interface Policy {
  defaultConf: Conf;
  /** Highest confidentiality that may go to a cloud model. Never "restricted". */
  maxCloudConf: Conf;
}

export interface Classification {
  kind: Kind;
  conf: Conf;
  flags: string[];
  reasons: string[]; // never contains matched text
  agentMayRead: boolean;
  agentMayEdit: boolean;
  mayLeaveDevice: boolean;
  collapseInDiff: boolean;
  sampleSha256: string;
}

export const SAMPLE_BYTES = 64 * 1024;

const PATH_RULES: Array<{ id: string; re: RegExp; kind: Kind; conf?: Conf; flags: string[] }> = [
  {
    id: 'credential-file', kind: 'credential', conf: 'restricted', flags: ['secret-file', 'no-edit'],
    re: /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]+)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)|credentials)$|\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i,
  },
  {
    id: 'lockfile', kind: 'lockfile', flags: ['collapse-diff'],
    re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/,
  },
  { id: 'vendored', kind: 'vendored', flags: ['collapse-diff', 'no-edit'], re: /(^|\/)(node_modules|vendor|third_party)\// },
  {
    id: 'generated', kind: 'generated', flags: ['collapse-diff', 'no-edit'],
    re: /(^|\/)(dist|build|out|coverage|\.next|\.turbo|target)\/|\.min\.(js|css)$|\.map$|\.generated\./,
  },
];

const EXT: Record<string, Kind> = {};
const addExt = (k: Kind, list: string) => {
  for (const e of list.split(' ')) EXT[e] = k;
};
addExt('source', 'ts tsx js jsx mjs cjs py rs go java kt c h cpp hpp cs rb php swift sh sql lua dart');
addExt('config', 'json yaml yml toml ini cfg conf xml');
addExt('doc', 'md mdx txt rst adoc pdf docx pptx');
addExt('data', 'csv tsv jsonl parquet xlsx xls db sqlite');
addExt('media', 'png jpg jpeg gif webp mp3 mp4 mov wav');
addExt('archive', 'zip tar gz tgz 7z rar');

const MAGIC: Array<[number[], Kind]> = [
  [[0x25, 0x50, 0x44, 0x46], 'doc'],
  [[0x89, 0x50, 0x4e, 0x47], 'media'],
  [[0xff, 0xd8, 0xff], 'media'],
  [[0x50, 0x4b, 0x03, 0x04], 'archive'],
  [[0x1f, 0x8b], 'archive'],
  [[0x7f, 0x45, 0x4c, 0x46], 'binary'],
];
const startsWith = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);

export function classifyBuffer(relPath: string, sample: Buffer, size: number, policy: Policy): Classification {
  if (policy.maxCloudConf === 'restricted') throw new Error('policy: restricted data may never leave the device');
  const path = relPath.split(sep).join('/');
  const flags = new Set<string>();
  const reasons: string[] = [];
  let kind: Kind = 'unknown';
  let conf = policy.defaultConf;

  const rule = PATH_RULES.find((r) => r.re.test(path));
  if (rule) {
    kind = rule.kind;
    for (const f of rule.flags) flags.add(f);
    reasons.push(`path-rule:${rule.id}`);
    if (rule.conf) conf = maxConf(conf, rule.conf);
  }

  const magic = MAGIC.find(([sig]) => startsWith(sample, sig));
  const binary = sample.includes(0) || magic !== undefined;
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  if (kind === 'unknown') kind = EXT[ext] ?? (binary ? (magic?.[1] ?? 'binary') : 'unknown');

  if (binary) {
    flags.add('opaque-binary');
    reasons.push('needs-extraction-before-cloud');
  } else if (sample.length > 0) {
    const s = scanText(sample.toString('utf8'));
    for (const f of s.flags) flags.add(f);
    conf = maxConf(conf, s.conf);
    if (s.flags.length > 0) reasons.push('content-scan');
  }

  const secret = [...flags].some((f) => f.startsWith('secret'));
  return {
    kind, conf, flags: [...flags], reasons,
    agentMayRead: kind !== 'credential',
    agentMayEdit: !flags.has('no-edit') && kind !== 'credential',
    mayLeaveDevice: confRank(conf) <= confRank(policy.maxCloudConf) && !secret && !flags.has('opaque-binary'),
    collapseInDiff: flags.has('collapse-diff') || size > 200_000,
    sampleSha256: sha256hex(sample),
  };
}

export async function classifyFile(root: string, relPath: string, policy: Policy): Promise<Classification> {
  const norm = relPath.split(sep).join('/');
  if (isAbsolute(relPath) || norm.split('/').includes('..')) throw new Error('path-escape');
  const abs = join(root, norm);
  const [realRoot, realParent] = await Promise.all([realpath(root), realpath(dirname(abs))]);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) throw new Error('path-escape');
  const ls = await lstat(abs);
  if (!ls.isFile()) throw new Error('not-a-regular-file'); // rejects symlinks, FIFOs, devices, directories
  const fh = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.ino !== ls.ino) throw new Error('changed-during-open'); // TOCTOU guard
    const buf = Buffer.alloc(Math.min(SAMPLE_BYTES, st.size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const c = classifyBuffer(norm, buf.subarray(0, bytesRead), st.size, policy);
    if (st.size > SAMPLE_BYTES) {
      c.flags.push('partial-scan');
      c.mayLeaveDevice = false; // fail closed: unscanned bytes may hold secrets
    }
    return c;
  } finally {
    await fh.close();
  }
}
