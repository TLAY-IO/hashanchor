# HashAnchor Client SDK

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Verifiable anchoring and payment infrastructure for machine applications.**

HashAnchor turns machine-generated events into portable evidence. Applications can
submit content or precomputed hashes, follow their progress into Merkle batches,
retrieve receipts anchored to public blockchains, and verify inclusion proofs
offline. The SDK also includes the first machine-payment adapter: a client for
relaying device-signed stablecoin authorizations to an x402 settlement endpoint.

This repository contains the Apache-2.0 JavaScript/TypeScript client, public types,
and integration contracts. The multi-tenant HashAnchor server is proprietary and
operated by TLAY; it is not included here and this repository is not a self-hostable
server distribution. `baseUrl` can target compatible managed deployments.

HashAnchor is part of the [TLAY](https://www.tlay.io) stack. Pair it with
[BoAT MER](https://github.com/TLAY-IO/boat-mer) when machines need to hold their own
keys and produce signed attestations or payment authorizations at the edge.

## What ships today

The product direction is provider-, protocol-, and asset-neutral. The current
public release is narrower by design:

| Capability | Status in this SDK |
|---|---|
| Hash and content submission | Shipped |
| Merkle-batch status and portable receipts | Shipped |
| Offline Merkle inclusion verification | Shipped |
| x402 V2 settlement for EVM networks through Circle Gateway and USDC | Shipped |
| MPP / Tempo | Available in the private HashAnchor server; not exposed by this SDK |
| Other payment networks and assets | Roadmap; not shipped |

Circle, Arc, x402, and USDC are the first concrete integration—not the definition
of the core product. A public reference implementation of that integration is
planned. Future ecosystem examples may cover Stripe MPP, Solana Pay / PayAI,
Coinbase x402, Lightning L402, Visa, and PayPal; these are roadmap directions, not
claims about the current SDK.

## Install

The package is not yet published to npm. Install the reviewed Git release:

```bash
npm install github:TLAY-IO/hashanchor#v1.0.1
```

The repository includes a `prepare` script, so Git-source installs build the
TypeScript output automatically. The package name is `@tlay/hashanchor-client`,
which is also the import path.

Requirements: Node.js 18 or later. Browser support depends on a runtime with
`fetch`; offline receipt verification has no network dependency.

## Five-minute anchoring flow

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

const client = new HashAnchor({
  apiKey: process.env.HASHANCHOR_API_KEY!,
});

// Let the service hash raw content.
const submitted = await client.anchor("hello machine economy");

// Or submit a 32-byte hash computed elsewhere.
await client.submitHash("0x" + "ab".repeat(32));

// Anchoring is asynchronous: pending → batched → anchored.
const status = await client.getStatus(submitted.hash);
const receipt = await client.getReceipt(submitted.hash);

console.log(status.status, receipt.anchor.txHash);
```

### Provision a development key

```ts
const { apiKey, plan, quota } = await HashAnchor.provision("my-app");
```

Provisioning currently creates a managed-service credential. Store it as a secret;
do not commit it to source control or firmware.

## Verify a receipt offline

```ts
import { verifyReceiptProof } from "@tlay/hashanchor-client";

const receipt = await client.getReceipt(hash);
const included = verifyReceiptProof(receipt);
```

`verifyReceiptProof()` checks the receipt's Merkle path locally. It proves that the
leaf belongs to the stated Merkle root; it does not independently query a blockchain.
Use `client.verify(hash)` when you also want the managed service to verify the anchor
transaction.

## Settle device-signed payments

The current payment adapter targets x402 V2 on EVM networks. It reshapes the flat
proof emitted by an edge device into the Circle Gateway envelope expected by
`POST /v1/x402/settle`. The payer's private key never reaches HashAnchor: the device
signs, the SDK preserves the signed fields, and the settlement endpoint relays them.

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

const ha = new HashAnchor(); // no API key required for the public settle endpoint

const results = await ha.settle({
  sid: "stream-1",
  batchIdx: 0,
  network: "eip155:5042002", // Arc Testnet
  proofs: [
    {
      sig: "0x…",            // 0x + r || s || v
      from: "0x…",
      to: "0x…",
      value: "10",           // atomic units, always a decimal string
      validAfter: 1718200000,
      validBefore: 1718804900,
      nonce: "0x…",          // 32 bytes, always a string
      slice_id: 0,
    },
  ],
});

for (const result of results) {
  if (result.success) console.log("settled", result.transaction);
  else console.warn("not confirmed", result.errorReason);
}
```

`value` and `nonce` must remain strings end to end. Converting either to a JavaScript
`number` can silently lose precision and invalidate the signature.

Results remain positionally aligned with `proofs`. A `success: false` item can mean a
provider rejection or a transport failure captured for that proof; do not retry it
blindly. In particular, `nonce_already_used` proves that the authorization nonce was
consumed, but does not by itself prove which settlement consumed it. Reconcile the
network, asset, payer, payee, and amount before treating it as prior success.

Use `buildSettlePayload()` when an application needs the Circle-native request without
sending it through the included HTTP client. Read the
[settle envelope](./docs/settle-envelope.md) and
[EIP-712 domain guide](./docs/eip712-domain-trap.md) before implementing a signer.

## API surface

| Method | Auth | Purpose |
|---|---|---|
| `new HashAnchor({ apiKey?, baseUrl? })` | — | Create a client. Default service: `https://hashanchor.xid.network`. |
| `HashAnchor.provision(name, options?)` | none | Provision a managed-service API key. |
| `anchor(content, options?)` | API key | Hash content and submit it for anchoring. |
| `submitHash(hash, options?)` | API key | Submit a precomputed `0x` + 32-byte hash. |
| `submitBatch(items)` | API key | Submit up to 100 hashes. |
| `getStatus(hash)` | API key | Read the anchoring lifecycle and anchor metadata. |
| `batchStatus(hashes)` | API key | Query several hashes at once. |
| `getQuota()` | API key | Read plan, quota, and rate-limit information. |
| `getReceipt(hash)` | none | Retrieve a portable receipt. |
| `verify(hash)` | none | Request Merkle and on-chain anchor verification. |
| `getChains()` | none | List anchoring chains advertised by the service. |
| `settle(envelope)` | none | Relay x402 payment proofs; returns one result per proof. |
| `buildSettlePayload(proof, options)` | offline | Reshape a proof without a network call. |
| `verifyReceiptProof(receipt)` | offline | Verify a Merkle inclusion path locally. |

Authenticated HTTP errors throw `HashAnchorError`, with the HTTP status in `.status`
and the parsed response in `.body`. `settle()` instead returns a result for each proof
so one failed item does not discard the rest of the batch.

## Trust boundaries

- **The SDK is not a wallet.** It accepts already-signed payment authorizations and
  never needs a payer private key.
- **Offline inclusion is not on-chain verification.** Verify the anchor transaction
  separately when independent chain assurance is required.
- **The hosted service is a dependency.** Anchoring, provisioning, status queries, and
  the included settlement relay use the configured `baseUrl`.
- **Integration support is release-specific.** A network mapping in the SDK does not
  guarantee that every external settlement provider currently accepts that network.
- **Retry with evidence.** Transport failures and ambiguous nonce outcomes require
  reconciliation; they are not proof of either settlement success or failure.

## Documentation

- [API reference](./docs/api-reference.md)
- [Receipt and settle-envelope schema](./docs/settle-envelope.md)
- [Sandbox onboarding](./docs/sandbox-onboarding.md)
- [EIP-712 Gateway-domain guide](./docs/eip712-domain-trap.md)

## Development

```bash
npm ci
npm test
npm pack --dry-run
```

`npm test` builds the TypeScript package before running the test suite.

## License

Apache-2.0 © 2024–2026 TLAY and HashAnchor contributors. See [LICENSE](./LICENSE)
and [NOTICE](./NOTICE).
