# HashAnchor Client SDK

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

Official JavaScript/TypeScript client SDK for **HashAnchor** — anchor data hashes to
public blockchains and verify cryptographic inclusion receipts.

HashAnchor batches your hashes into a Merkle tree, anchors the root on-chain, and
issues a portable receipt that proves a hash existed at a point in time.

This SDK and the public contracts in it are Apache-2.0. The multi-tenant HashAnchor
server is proprietary and operated by TLAY — this repository does not contain a
self-hostable server. `baseUrl` can target compatible managed deployments.

> Part of the [TLAY](https://www.tlay.io) open-source stack — *the Embedded Trust Layer
> for the Machine Economy.* See also [BoAT MER](https://github.com/TLAY-IO/boat-mer),
> the on-device Machine Economy Runtime.

## Install

Not yet published to npm. Install from this repository at a release tag:

```bash
npm install github:TLAY-IO/hashanchor#v1.0.0
```

The package builds itself on install (`prepare` script), so no extra build step is
needed. The package name is `@tlay/hashanchor-client`, so imports look the same as they
will once it is published to npm.

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

### Settle x402 nanopayments (device-to-device)

For machine-to-machine payments, HashAnchor exposes a **public, stateless x402
facilitator** at `POST /v1/x402/settle` — it relays a signed payment to the Circle
Gateway and returns the result. No API key, no private key on the server, no gas.

A settlement worker takes the flat payment proofs that devices emit on the wire (e.g.
a BLE 0xEE04 slice proof, forwarded over MQTT) and settles them in one call. The SDK
owns the reshape into the Circle-native format — including the precision-critical bits
(uint256 `value` and 32-byte `nonce` are kept as strings, never JS numbers; `v` is the
last byte of the signature, 27/28) — so the device, the broker, and your worker carry
the proof verbatim:

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

const ha = new HashAnchor(); // no API key needed for settle

const results = await ha.settle({
  sid: "stream-1",
  batchIdx: 0,
  network: "eip155:5042002", // Arc Testnet (carried from the device, not hardcoded)
  proofs: [
    {
      sig: "0x…",            // "0x" + r||s||v (132 hex)
      from: "0x…", to: "0x…",
      value: "10",           // decimal µUSDC — string, always
      validAfter: 1718200000,
      validBefore: 1718203600,
      nonce: "0x…",          // 0x + 64 hex
      slice_id: 0,
    },
  ],
});

for (const r of results) {
  if (r.success) console.log("settled", r.transaction);
  // `nonce_already_used` is the idempotent rejection of an already-settled proof
  // (expected under at-least-once delivery) — de-dup on (payer, nonce), don't alarm.
  else console.warn(r.errorReason);
}
```

Results are positionally aligned with `proofs`. A `success:false` result (including a
single proof's transport fault) is returned, never thrown — one bad proof never sinks
the batch. See the [settle envelope schema](./docs/settle-envelope.md) and the
[EIP-712 Gateway-domain trap](./docs/eip712-domain-trap.md) before signing.

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
| `settle(envelope)` | none | Settle a batch of x402 nanopayment proofs via the public facilitator. Returns one `SettleResult` per proof. |
| `buildSettlePayload(proof, { network, asset? })` | — | **Offline** reshape of one flat proof into a Circle-native settle request (no network). |
| `verifyReceiptProof(receipt)` | — | **Offline** Merkle-proof check (no network). |

`settle()` returns `SettleResult[]` (never throws on a settlement outcome); only the
authenticated methods (`anchor`, `submitHash`, `submitBatch`, `getStatus`,
`batchStatus`, `getQuota`) require an API key — construct with `{ apiKey }` for those.

All errors throw `HashAnchorError` with `.status` and `.body`.

## Docs

- [API reference](./docs/api-reference.md)
- [Receipt & settle envelope schema](./docs/settle-envelope.md)
- [Sandbox onboarding](./docs/sandbox-onboarding.md)
- [⚠️ EIP-712 Gateway-domain trap](./docs/eip712-domain-trap.md) — read before signing x402 payments

## License

Apache-2.0 © 2024-2026 TLAY and HashAnchor Contributors. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
