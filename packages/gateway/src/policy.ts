import { matchesResource } from '@si/grants';

export interface PolicyBundle {
  readonly version: string;
  /** Resource patterns that are always denied, whatever the grants say. */
  readonly denyResources: readonly string[];
}

export const denies = (p: PolicyBundle, resource: string): string | undefined =>
  p.denyResources.find((pattern) => matchesResource(pattern, resource));
