export const CONF_LEVELS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Conf = (typeof CONF_LEVELS)[number];

/** Low to high trust. */
export const INTEGRITY_LEVELS = ['untrusted', 'tool', 'user', 'trusted'] as const;
export type Integrity = (typeof INTEGRITY_LEVELS)[number];

export interface Label {
  readonly conf: Conf;
  readonly integrity: Integrity;
  readonly provenance: readonly string[];
}

export const confRank = (c: Conf): number => CONF_LEVELS.indexOf(c);
export const integrityRank = (i: Integrity): number => INTEGRITY_LEVELS.indexOf(i);
export const maxConf = (a: Conf, b: Conf): Conf => (confRank(a) >= confRank(b) ? a : b);

export const BOTTOM_LABEL: Label = { conf: 'public', integrity: 'trusted', provenance: [] };

/** Join on derivation: max confidentiality, min integrity, union of provenance. */
export function joinLabels(...labels: readonly Label[]): Label {
  let conf: Conf = 'public';
  let integrity: Integrity = 'trusted';
  const provenance = new Set<string>();
  for (const l of labels) {
    if (confRank(l.conf) > confRank(conf)) conf = l.conf;
    if (integrityRank(l.integrity) < integrityRank(integrity)) integrity = l.integrity;
    for (const p of l.provenance) provenance.add(p);
  }
  return { conf, integrity, provenance: [...provenance].sort() };
}

/** May data with this label flow to a sink that accepts up to `sinkMax`? */
export const flowAllowed = (l: Label, sinkMax: Conf): boolean => confRank(l.conf) <= confRank(sinkMax);
