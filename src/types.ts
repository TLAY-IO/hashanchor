// Client-facing types for the HashAnchor SDK.
// Server-only schemas (device registration, signed submission, etc.) intentionally
// live in the private hashanchor-server repo and are not part of this public SDK.

export interface ProofElement {
  position: "left" | "right";
  data: string;
}

export interface AnchorReceipt {
  "@context": "https://hashanchor.io/receipt/v1";
  hash: string;
  merkleRoot: string;
  proof: ProofElement[];
  anchor: {
    chainId: number;
    contractAddress: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: number;
  };
  signature?: string;
}

export type HashStatus = "pending" | "batched" | "anchored" | "failed";
