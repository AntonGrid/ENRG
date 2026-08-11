import { createHash } from "crypto";

export function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

export function merkleHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([left, right]));
}

export interface MerkleTree {
  leaves: Buffer[];
  levels: Buffer[][];
  root: Buffer;
}

export function buildMerkleTree(rawLeaves: Buffer[]): MerkleTree {
  const leaves = rawLeaves.map((l) => sha256(l));
  const levels: Buffer[][] = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(merkleHash(level[i], level[i + 1] ?? level[i]));
    }
    levels.push(next);
    level = next;
  }
  return { leaves, levels, root: levels[levels.length - 1][0] };
}

export function getProof(tree: MerkleTree, index: number): Buffer[] {
  const proof: Buffer[] = [];
  let idx = index;
  for (let li = 0; li < tree.levels.length - 1; li++) {
    const level = tree.levels[li];
    const sibling = idx % 2 === 1 ? idx - 1 : idx + 1;
    proof.push(sibling < level.length ? level[sibling] : level[idx]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function leafHash(rawLeaf: Buffer): Buffer {
  return sha256(rawLeaf);
}
