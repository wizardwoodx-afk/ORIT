import { sha256hex } from '@si/core';

/** RFC 6962 style domain separation: 0x00 for leaves, 0x01 for interior nodes. */
const leaf = (hex: string) => sha256hex(Buffer.concat([Buffer.from([0]), Buffer.from(hex, 'hex')]));
const node = (a: string, b: string) =>
  sha256hex(Buffer.concat([Buffer.from([1]), Buffer.from(a, 'hex'), Buffer.from(b, 'hex')]));

export function merkleRoot(hexHashes: readonly string[]): string {
  if (hexHashes.length === 0) return sha256hex('');
  let level = hexHashes.map(leaf);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i] as string;
      const b = level[i + 1];
      next.push(b === undefined ? a : node(a, b));
    }
    level = next;
  }
  return level[0] as string;
}
