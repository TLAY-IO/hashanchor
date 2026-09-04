// @tlay/hashanchor-client — official client SDK for the HashAnchor anchoring API.
// Apache-2.0. Part of the TLAY open-source stack (https://github.com/TLAY-IO).

export * from "./types.js";
export { verifyMerkleProof, hexToBuffer, bufferToHex } from "./merkle.js";
export { verifyReceiptProof } from "./receipt.js";

import type { AnchorReceipt } from "./types.js";

export interface HashAnchorConfig {
  /**
   * API key (ha_ prefix) for authenticated endpoints (anchoring, quota, status).
   * Optional: the public endpoints — `settle()`, `verify()`, `getReceipt()`,
   * `getChains()` — work without a key. A settle-only client (e.g. an x402
   * settlement worker) can be constructed with no apiKey at all.
   */
  apiKey?: string;
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

// ── x402 settle (device-to-device nanopayments) ──

/**
 * A single flat payment proof as emitted on the wire (BLE 0xEE04 / MQTT).
 * This is the frozen format produced by the BoAT buyer engine — fields are
 * carried verbatim end-to-end; only the SDK reshapes them for the facilitator.
 *
 * IMPORTANT: `value` and `nonce` are strings and MUST stay strings the whole way.
 * Never round-trip them through a JS `number` — a uint256 value or 32-byte nonce
 * exceeds 2^53 and silently loses precision, producing a signature that recovers
 * to the wrong payer and a silent Circle rejection.
 */
export interface SettleProof {
  /** "0x" + r(32B) + s(32B) + v(1B); v is the last byte, ∈ {27, 28}. */
  sig: string;
  from: string;
  to: string;
  /** Decimal string of atomic units (µUSDC). Never a number. */
  value: string;
  validAfter: number | string;
  validBefore: number | string;
  /** "0x" + 64 hex. Opaque — never a number. */
  nonce: string;
  /** Per-stream slice index; used only for client-side idempotency. */
  slice_id?: number;
}

/** A batch of proofs to settle on one network (e.g. one MQTT settle message). */
export interface SettleEnvelope {
  sid: string;
  batchIdx: number;
  /** CAIP-2 network, e.g. "eip155:5042002" (Arc Testnet). */
  network: string;
  /** USDC asset address; defaults to the canonical USDC for `network`. */
  asset?: string;
  proofs: SettleProof[];
}

/** The Circle-native request body POSTed to `/v1/x402/settle`. */
export interface SettleRequest {
  x402Version: number;
  paymentPayload: string;
  paymentRequirements: {
    network: string;
    scheme?: string;
    asset?: string;
    amount?: string;
    payTo?: string;
    maxTimeoutSeconds?: number;
    extra?: Record<string, unknown>;
  };
}

export interface SettleResult {
  success: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  errorReason?: string | null;
  chainId?: number;
}

/** Canonical USDC contract per supported network (mirrors the server config). */
const USDC_BY_NETWORK: Record<string, string> = {
  "eip155:5042002": "0x3600000000000000000000000000000000000000", // Arc Testnet
  "eip155:5042": "0x3600000000000000000000000000000000000000", // Arc Mainnet
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
  "eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon
};

/**
 * Circle Gateway (GatewayWallet) contract per network — the EIP-712
 * `verifyingContract` of the `GatewayWalletBatched` signing domain.
 *
 * The grouping is by **testnet vs mainnet**, not by chain family: every testnet
 * shares one deployment and every mainnet shares another. Two different things
 * are easy to confuse here — Circle's *domain number* does go by chain family
 * (a chain's testnet and mainnet share it), but the *contract address* does not.
 * Conflating the two is how this table previously carried a testnet address for
 * Arc Mainnet.
 *
 * Authoritative source: Circle's live `GET /v1/x402/supported`, which returns the
 * `extra` block (name, version, verifyingContract) per network. Read it there
 * rather than from a document — the mainnet address changed once already, and a
 * stale address does not fail loudly: the signature simply recovers to the wrong
 * payer and the settlement is refused with no hint at the cause.
 */
const GATEWAY_BY_NETWORK: Record<string, string> = {
  "eip155:5042002": "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", // Arc Testnet
  "eip155:5042": "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", // Arc Mainnet
  "eip155:84532": "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", // Base Sepolia
  "eip155:8453": "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", // Base mainnet
  "eip155:137": "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", // Polygon mainnet
};

function toBase64(s: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(s, "utf-8").toString("base64");
  }
  // Browser fallback (UTF-8 safe).
  return btoa(
    encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
  );
}

/**
 * Default validity window (seconds) advertised as `maxTimeoutSeconds` — 7 days + 100 s.
 *
 * WHY THIS VALUE: Circle Gateway rejects an authorization whose validity window is
 * shorter than 7 days with `authorization_validity_too_short`. Circle's own SDK
 * (`GatewayEvmScheme`) uses 604900 = 7 days plus a 100 second buffer, so we match it.
 * See https://developers.circle.com/gateway/nanopayments/references/sdk
 *
 * Do not lower this without re-checking the settlement provider's requirement. A short
 * window fails at *settle* time, not at signing time, so nothing upstream reports an
 * error — the payment simply never lands.
 *
 * NOTE: some Circle documentation pages still say 3 days. They are wrong in practice:
 * production rejected a ~4 day window on 2026-08-11. Do not "correct" this back down
 * on the strength of those pages.
 */
const DEFAULT_MAX_TIMEOUT_SECONDS = 604900;

/**
 * Reshape one flat wire proof into the Circle-native settle request, matching
 * the full x402 V2 batched-facilitator schema (verified against a live settle):
 *
 * - flat → nested `payload.authorization.*`, `sig` → `payload.signature`
 * - `validAfter`/`validBefore` stringified; `value`/`nonce` carried verbatim
 * - `payload.resource` + `payload.accepted` — **both REQUIRED** by Circle's
 *   facilitator (omitting them returns "Invalid request: ...resource: Required")
 * - `accepted` / `paymentRequirements` carry `amount` (= signed value),
 *   `maxTimeoutSeconds`, and the GatewayWalletBatched EIP-712 domain in `extra`
 *   (needed to verify the signature; the server forwards this to Circle unchanged)
 * - `slice_id` rides in `paymentRequirements.extra.sliceId` for idempotency
 *
 * Exported for callers who want the request without sending it (testing,
 * custom transports). Most callers should use `HashAnchor.settle()`.
 */
export function buildSettlePayload(
  proof: SettleProof,
  opts: { network: string; asset?: string; resourceUrl?: string }
): SettleRequest {
  const asset = opts.asset ?? USDC_BY_NETWORK[opts.network];
  const amount = String(proof.value);
  const domain = {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: GATEWAY_BY_NETWORK[opts.network],
  };
  // The accepted payment requirement — Circle requires this inside the payload
  // and it must mirror the offer the signature was produced against.
  const accepted = {
    scheme: "exact",
    network: opts.network,
    asset,
    amount,
    payTo: proof.to,
    maxTimeoutSeconds: DEFAULT_MAX_TIMEOUT_SECONDS,
    extra: domain,
  };
  const nano = {
    x402Version: 2,
    resource: {
      url: opts.resourceUrl ?? "https://hashanchor.xid.network/v1/x402/settle",
      description: "BoAT nanopayment slice",
      mimeType: "application/json",
    },
    accepted,
    payload: {
      signature: proof.sig,
      authorization: {
        from: proof.from,
        to: proof.to,
        value: amount,
        validAfter: String(proof.validAfter),
        validBefore: String(proof.validBefore),
        nonce: proof.nonce,
      },
    },
  };
  const paymentRequirements: SettleRequest["paymentRequirements"] = {
    network: opts.network,
    scheme: "exact",
    asset,
    amount,
    payTo: proof.to,
    maxTimeoutSeconds: DEFAULT_MAX_TIMEOUT_SECONDS,
    extra:
      proof.slice_id !== undefined ? { ...domain, sliceId: proof.slice_id } : domain,
  };
  return {
    x402Version: 2,
    paymentPayload: toBase64(JSON.stringify(nano)),
    paymentRequirements,
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

  constructor(config: HashAnchorConfig = {}) {
    this.apiKey = config.apiKey ?? "";
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
    if (!this.apiKey) {
      throw new HashAnchorError(
        `${method} ${path} requires an API key. ` +
          `Construct HashAnchor with { apiKey }, or use a public method ` +
          `(settle, verify, getReceipt, getChains).`,
        401
      );
    }
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

  // ── x402 settle (public stateless facilitator relay) ──

  /**
   * Settle a batch of nanopayment proofs via HashAnchor's public
   * `POST /v1/x402/settle` facilitator (no API key required).
   *
   * Each proof is reshaped (see `buildSettlePayload`) and relayed to the Circle
   * Gateway; HashAnchor holds no key, connects to no RPC, and pays no gas. The
   * returned array is positionally aligned with `envelope.proofs`.
   *
   * A `success:false` result can be a provider rejection or a transport fault
   * captured for that proof. Do not retry it blindly. In particular,
   * `nonce_already_used` proves that the authorization nonce was consumed, but
   * does not by itself identify which settlement consumed it; reconcile the
   * network, asset, payer, payee, and amount before treating it as prior success.
   * One failed proof never sinks the batch.
   */
  async settle(envelope: SettleEnvelope): Promise<SettleResult[]> {
    const results: SettleResult[] = [];
    for (const proof of envelope.proofs) {
      const req = buildSettlePayload(proof, {
        network: envelope.network,
        asset: envelope.asset,
      });
      try {
        results.push(await this.settleOne(req));
      } catch (err) {
        results.push({
          success: false,
          errorReason:
            err instanceof Error ? err.message : "settle request failed",
          network: envelope.network,
        });
      }
    }
    return results;
  }

  /**
   * Relay a single pre-built settle request. `200` → `success:true`; `402` →
   * `success:false` with `errorReason` (a valid settlement outcome, returned
   * not thrown). Only genuine faults (400 bad request, 5xx, network) throw.
   */
  private async settleOne(req: SettleRequest): Promise<SettleResult> {
    const res = await fetch(`${this.baseUrl}/v1/x402/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const body = (await res.json().catch(() => null)) as SettleResult | null;
    if (res.status === 200 || res.status === 402) {
      return (
        body ?? { success: res.status === 200, network: req.paymentRequirements.network }
      );
    }
    throw new HashAnchorError(
      (body as any)?.errorReason ??
        (body as any)?.error ??
        `Settle failed (${res.status})`,
      res.status,
      body
    );
  }
}

export default HashAnchor;
