import type { AnchorReceipt } from "./types.js";
import { verifyMerkleProof, hexToBuffer } from "./merkle.js";

/**
 * Locally verify that a receipt's Merkle proof connects its `hash` (leaf)
 * to its `merkleRoot`. This is an offline check — it does NOT confirm that
 * `merkleRoot` was actually anchored on-chain. To confirm the on-chain anchor,
 * read the contract at `anchor.contractAddress` / `anchor.txHash`, or call
 * `client.verify(hash)` which checks both.
 */
export function verifyReceiptProof(receipt: AnchorReceipt): boolean {
  if (!receipt?.hash || !receipt?.merkleRoot || !Array.isArray(receipt?.proof)) {
    return false;
  }
  return verifyMerkleProof(
    hexToBuffer(receipt.hash),
    receipt.proof,
    hexToBuffer(receipt.merkleRoot)
  );
}
