# HashAnchor Client SDK

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@tlay/hashanchor-client.svg)](https://www.npmjs.com/package/@tlay/hashanchor-client)

Official JavaScript/TypeScript client SDK for **HashAnchor** — anchor data hashes to
public blockchains and verify cryptographic inclusion receipts.

HashAnchor batches your hashes into a Merkle tree, anchors the root on-chain, and
issues a portable receipt that proves a hash existed at a point in time. This SDK is the
thin client over the HashAnchor HTTP API; the anchoring service itself is operated by
TLAY (commercial / self-hostable).

> Part of the [TLAY](https://www.tlay.io) open-source stack — *the Embedded Trust Layer
> for the Machine Economy.* See also [BoAT MER](https://github.com/TLAY-IO/boat-mer),
> the on-device Machine Economy Runtime.

## Install

```bash
npm install @tlay/hashanchor-client
```

## Quickstart

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

const client = new HashAnchor({ apiKey: process.env.HASHANCHOR_API_KEY! });

// Anchor arbitrary content (server hashes it for you)
const res = await client.anchor("hello machine economy");
console.log(res.status, res.hash);

// ...or submit a hash you computed yourself (sha256/keccak, 0x + 32 bytes)
await client.submitHash("0x" + "ab".repeat(32));

// Check status / fetch the receipt once anchored
const status = await client.getStatus(res.hash);
const receipt = await client.getReceipt(res.hash);
```

### No API key? Provision one instantly

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

const { apiKey, plan, quota } = await HashAnchor.provision("my-app");
// store apiKey; free tier — no email, no credit card
```

### Verify a receipt offline

The SDK can verify a receipt's Merkle proof locally, without trusting the server:

```ts
import { verifyReceiptProof } from "@tlay/hashanchor-client";

const receipt = await client.getReceipt(hash);
const proofOk = verifyReceiptProof(receipt); // leaf → merkleRoot, keccak256

// proofOk confirms the hash is in the tree. To also confirm the root was
// committed on-chain, call client.verify(hash) (checks proof AND the anchor tx).
const v = await client.verify(hash);
console.log(v.verified, v.anchor?.txHash);
```

## API

| Method | Auth | Description |
|--------|------|-------------|
| `new HashAnchor({ apiKey, baseUrl? })` | — | Construct a client. Default `baseUrl` = `https://hashanchor.xid.network`. |
| `HashAnchor.provision(name, { email?, baseUrl? })` | none | Self-serve a free API key. |
| `anchor(content, { format?, metadata?, externalId? })` | key | Hash + anchor raw content (`text`/`base64`). |
| `submitHash(hash, { metadata?, externalId? })` | key | Submit a pre-computed `0x`+32-byte hash. |
| `submitBatch(items)` | key | Submit up to 100 hashes at once. |
| `getStatus(hash)` | key | Lifecycle: `pending → batched → anchored`. |
| `batchStatus(hashes)` | key | Bulk status lookup. |
| `getQuota()` | key | Plan + remaining monthly quota. |
| `verify(hash)` | none | Server-side proof + on-chain anchor verification. |
| `getReceipt(hash)` | none | Portable JSON receipt (`@context` + Merkle proof + anchor). |
| `getChains()` | none | Supported anchoring chains. |
| `verifyReceiptProof(receipt)` | — | **Offline** Merkle-proof check (no network). |

All errors throw `HashAnchorError` with `.status` and `.body`.

## Docs

- [API reference](./docs/api-reference.md)
- [Receipt & settle envelope schema](./docs/settle-envelope.md)
- [Sandbox onboarding](./docs/sandbox-onboarding.md)
- [⚠️ EIP-712 Gateway-domain trap](./docs/eip712-domain-trap.md) — read before signing x402 payments

## License

Apache-2.0 © 2024-2026 TLAY and HashAnchor Contributors. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
