/**
 * SelfImpulse — spaces.
 *
 * Co-think and Co-work are separate typed runtime contexts (ADR 3), not a mode flag: their own
 * ledger, keys, workspace, policy ceiling and trust dial. Nothing here can read across the line.
 */
export const SPACE_IDS = ['co-think', 'co-work'] as const;
export type SpaceId = (typeof SPACE_IDS)[number];

export interface SpaceConfig {
  readonly id: SpaceId;
  readonly label: string;
  readonly note: string;
  /** Highest confidentiality this Space may hold. */
  readonly policyCeiling: 'internal' | 'confidential' | 'restricted';
  /** 1 Observe, 2 Ask, 3 Flow, 4 Run-scoped, 5 Standing. */
  readonly dial: 1 | 2 | 3 | 4 | 5;
  /** Resources no grant may reach inside this Space. */
  readonly denyResources: readonly string[];
}

export const SPACES: Readonly<Record<SpaceId, SpaceConfig>> = {
  'co-think': {
    id: 'co-think',
    label: 'Co-think',
    note: 'Personal. Your notes, your drafts, your reading.',
    policyCeiling: 'confidential',
    dial: 3,
    denyResources: ['fs:**/.env', 'fs:**/.ssh/**', 'fs:**/id_rsa*', 'fs:**/credentials*'],
  },
  'co-work': {
    id: 'co-work',
    label: 'Co-work',
    note: 'Organization. Sharper ceiling, wider deny list.',
    policyCeiling: 'internal',
    dial: 2,
    denyResources: ['fs:**/.env', 'fs:**/.ssh/**', 'fs:**/id_rsa*', 'fs:**/credentials*', 'fs:**/secrets/**'],
  },
};

export const isSpaceId = (value: unknown): value is SpaceId =>
  typeof value === 'string' && (SPACE_IDS as readonly string[]).includes(value);
