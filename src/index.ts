// @tlay/hashanchor-client — official client SDK for the HashAnchor anchoring API.
// Apache-2.0. Part of the TLAY open-source stack (https://github.com/TLAY-IO).

export * from "./types.js";
export { verifyMerkleProof, hexToBuffer, bufferToHex } from "./merkle.js";
export { verifyReceiptProof } from "./receipt.js";

import type { AnchorReceipt } from "./types.js";

export interface HashAnchorConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface AnchorOptions {
  metadata?: Record<string, unknown>;
  externalId?: string;
}

export interface SubmitResult {
  status: "accepted" | "duplicate";
  id: string;
  hash: string;
  metadata?: Record<string, unknown> | null;
}

export interface BatchSubmitResult {
  accepted: number;
  duplicates: number;
  results: SubmitResult[];
}

export interface HashStatusResult {
  id: string;
  hash: string;
  status: "pending" | "batched" | "anchored" | "failed";
  externalId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  batch?: {
    id: string;
    merkleRoot: string | null;
    status: string | null;
  } | null;
  anchor?: {
    txHash: string;
    blockNumber: string | bigint;
  } | null;
  receipt?: Record<string, unknown> | null;
}

export interface BatchStatusItem {
  hash: string;
  status: string;
  txHash?: string;
  blockTimestamp?: string;
}

export interface QuotaResult {
  plan: string;
  monthly: {
    limit: number;
    used: number;
    remaining: number;
  };
  rateLimit: {
    limit: number;
    perMinute: boolean;
  };
}

export interface VerifyResult {
  verified: boolean;
  status: string;
  hash: string;
  anchor?: {
    txHash: string;
    blockNumber: number;
    blockTimestamp: number;
    chainId: number;
    contractAddress: string;
    onChainTimestamp?: number;
  } | null;
  receipt?: Record<string, unknown> | null;
}

export type ReceiptResult = AnchorReceipt;

export interface ChainInfo {
  id: string;
  name: string;
  chainId: number;
}

export interface ProvisionResult {
  tenantId: string;
  apiKey: string;
  plan: string;
  quota: {
    limit: number;
    remaining: number;
  };
}

export class HashAnchorError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "HashAnchorError";
  }
}

export class HashAnchor {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: HashAnchorConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://hashanchor.xid.network").replace(
      /\/$/,
      ""
    );
  }

  // ── Static provisioning (no API key needed) ──

  static async provision(
    name: string,
    options?: { email?: string; baseUrl?: string }
  ): Promise<ProvisionResult> {
    const baseUrl = (
      options?.baseUrl ?? "https://hashanchor.xid.network"
    ).replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/auth/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email: options?.email }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new HashAnchorError(
        (body as any)?.error ?? `Provision failed (${res.status})`,
        res.status,
        body
      );
    }
    return res.json() as Promise<ProvisionResult>;
  }

  // ── Private helpers ──

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new HashAnchorError(
        (errBody as any)?.error ?? `Request failed (${res.status})`,
        res.status,
        errBody
      );
    }
    return res.json() as Promise<T>;
  }

  private async requestPublic<T>(method: string, path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { method });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new HashAnchorError(
        (errBody as any)?.error ?? `Request failed (${res.status})`,
        res.status,
        errBody
      );
    }
    return res.json() as Promise<T>;
  }

  // ── Content-based anchoring ──

  async anchor(
    content: string,
    options?: AnchorOptions & { format?: "text" | "base64" }
  ): Promise<SubmitResult> {
    return this.request("POST", "/v1/hashes/anchor", {
      content,
      format: options?.format ?? "text",
      metadata: options?.metadata,
      externalId: options?.externalId,
    });
  }

  // ── Hash submission ──

  async submitHash(hash: string, options?: AnchorOptions): Promise<SubmitResult> {
    return this.request("POST", "/v1/hashes", {
      hash,
      metadata: options?.metadata,
      externalId: options?.externalId,
    });
  }

  async submitBatch(
    hashes: Array<{
      hash: string;
      externalId?: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<BatchSubmitResult> {
    return this.request("POST", "/v1/hashes/batch", { hashes });
  }

  // ── Queries ──

  async getStatus(hash: string): Promise<HashStatusResult> {
    return this.request("GET", `/v1/hashes/${hash}`);
  }

  async batchStatus(hashes: string[]): Promise<{ results: BatchStatusItem[] }> {
    return this.request("POST", "/v1/hashes/status", { hashes });
  }

  async getQuota(): Promise<QuotaResult> {
    return this.request("GET", "/v1/quota");
  }

  // ── Public endpoints (no API key required) ──

  async verify(hash: string): Promise<VerifyResult> {
    return this.requestPublic("GET", `/v1/verify/${hash}`);
  }

  async getReceipt(hash: string): Promise<ReceiptResult> {
    return this.requestPublic("GET", `/v1/receipts/${hash}`);
  }

  async getChains(): Promise<ChainInfo[]> {
    return this.requestPublic("GET", "/v1/chains");
  }
}

export default HashAnchor;
