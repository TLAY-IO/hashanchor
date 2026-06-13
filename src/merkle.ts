import { MerkleTree } from "merkletreejs";
import sha3 from "js-sha3";
import type { ProofElement } from "./types.js";

const { keccak256 } = sha3;

function keccak256Buffer(data: Buffer): Buffer {
  return Buffer.from(keccak256.arrayBuffer(data));
}

/**
 * Verify a Merkle inclusion proof for `leaf` against `root`.
 * Uses keccak256 with sorted pairs — matching the HashAnchor batch builder.
 */
export function verifyMerkleProof(
  leaf: Buffer,
  proof: ProofElement[],
  root: Buffer
): boolean {
  const proofBuffers = proof.map((p) => ({
    position: p.position,
    data: Buffer.from(p.data.replace("0x", ""), "hex"),
  }));
  const tree = new MerkleTree([], keccak256Buffer, { sortPairs: true });
  return tree.verify(proofBuffers, leaf, root);
}

export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace("0x", ""), "hex");
}

export function bufferToHex(buf: Buffer): string {
  return "0x" + buf.toString("hex");
}
