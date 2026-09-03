# HashAnchor Client SDK

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Verifiable anchoring and payment infrastructure for machine applications.**

HashAnchor turns machine-generated events into portable evidence. Applications
submit content or precomputed hashes, follow their progress into Merkle batches,
retrieve receipts anchored to public blockchains, and verify inclusion proofs
offline. The SDK also ships a machine-payment adapter: a client for relaying
device-signed stablecoin authorizations to an x402 settlement endpoint.

This repository is the **client SDK only**. It contains the Apache-2.0
JavaScript/TypeScript client, public types, and integration contracts. The
multi-tenant HashAnchor server is proprietary and operated by TLAY — it is not in
this repository, and **cloning this repository does not give you a HashAnchor
server**. Every networked call here targets a hosted deployment; `baseUrl` lets
you point at a compatible one.

HashAnchor is part of the [TLAY](https://www.tlay.io) stack. Pair it with
[BoAT MER](https://github.com/TLAY-IO/boat-mer) when machines need to hold their
own keys and produce the signed attestations or payment authorizations that this
SDK carries.

---

## Which of these are you here for?

The SDK serves **two different jobs**. They share a package and nothing else —
different auth, different timing, different failure modes. Read the one you need.

| | **A · Anchor and verify machine data** | **B · Settle device-signed payments** |
|---|---|---|
| You want to | prove a piece of data existed, unchanged, at a point in time | relay a payment authorization a device already signed |
| Auth | **API key required** | **no API key** |
| Timing | **asynchronous** — minutes, not milliseconds | synchronous — outcome in the response |
| You supply | content, or a 32-byte hash | a signed proof from an edge device |
| You get | a receipt with a Merkle proof and an anchor transaction | one settlement outcome per proof |
| Failure shape | **throws** `HashAnchorError` | **returns** `success: false` — never throws for a rejected payment |
| Start at | [Path A](#path-a--anchor-and-verify-machine-data) | [Path B](#path-b--settle-device-signed-payments) |

**The single most common mistake is treating Path A as synchronous.** It is not;
[Path A](#path-a--anchor-and-verify-machine-data) shows what to do instead.

---

## Install

**This package is not published to npm.** Installing it from the registry by
package name fails with a 404 — the name is unclaimed. Install the reviewed Git
release:

```bash
npm install github:TLAY-IO/hashanchor#v1.0.1
```

**Pin a tag, never a branch.** `#main` moves under you; a tag does not. Check this
repository's tag list for the current release before pinning, and change the tag
deliberately to upgrade — there is no registry version range to resolve for you.

**Confirm what you actually installed:**

```bash
npm ls @tlay/hashanchor-client
node -p "require('./node_modules/@tlay/hashanchor-client/package.json').version"
```

The lockfile's `resolved` entry — not its version spec — records the exact commit
you are running. If the two disagree, the `resolved` commit is what ships.

**Why a Git install works without a build step:** the package publishes
TypeScript sources, and a `prepare` script compiles them on install, so `dist/` is
produced automatically. This holds for anonymous HTTPS installs and inside Docker
builds that run `npm install --omit=dev` — npm installs the package's own build
dependencies to run `prepare` regardless of that flag.

⚠️ **Two consequences worth knowing before you containerize:**

- A Git dependency needs `git` in the image. Slim bases (`node:*-alpine`) do not
  have it, and `npm install` then fails with `spawn git ENOENT`.
- **Do not swap the Git dependency for a source tarball URL to avoid that.** npm
  runs `prepare` for Git dependencies but **not** for tarballs, so a tarball
  install succeeds, produces no `dist/`, and fails at runtime with
  `ERR_MODULE_NOT_FOUND` — a build-time error turned into a runtime one.

Requirements: Node.js 18 or later. In a browser, a runtime with `fetch`. Offline
receipt verification has no network dependency at all.

---

## Path A · Anchor and verify machine data

### The proof chain

```
   your event                     what HashAnchor does                 what you can check
   ──────────                     ────────────────────                 ──────────────────

   event / payload
        │
        │  SHA-256 (yours, or the service's)
        ▼
   32-byte hash  ──────────►  collected into a Merkle batch
                                        │
                                        │  batch closes (interval-driven)
                                        ▼
                                   Merkle root
                                        │
                                        │  one transaction
                                        ▼
                              root anchored on a public chain
                                        │
                                        ▼
                              portable receipt  ──────────►  verifyReceiptProof()
                              (hash + path + root                offline, no network
                               + anchor tx)                  ──────────►  read the anchor
                                                                  tx yourself, on-chain
```

Everything after "32-byte hash" happens **without you**, on the service's batch
schedule. That is why Path A is asynchronous.

### 1 · Get a key

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

const { apiKey, plan, quota } = await HashAnchor.provision("my-app");
```

Expected shape:

```json
{ "tenantId": "…", "apiKey": "ha_…", "plan": "free",
  "quota": { "limit": 100, "remaining": 100 } }
```

This creates a credential on the hosted service. Store it as a secret; do not
commit it to source control or flash it into firmware.

**Common failures:** a missing `name` returns HTTP 400. Every authenticated call
made without a key throws `HashAnchorError` with `.status === 401` before any
request is sent.

### 2 · Submit

```ts
const client = new HashAnchor({ apiKey: process.env.HASHANCHOR_API_KEY! });

// Let the service hash raw content …
const submitted = await client.anchor("hello machine economy");

// … or submit a 32-byte hash you computed yourself.
await client.submitHash("0x" + "ab".repeat(32));

console.log(submitted.hash); // keep this — it is how you look the record up
```

Expected shape:

```json
{ "status": "accepted", "id": "…", "hash": "0x…" }
```

`status` is `"accepted"` or `"duplicate"`. **Neither means anchored** — the hash
is queued, and nothing is on-chain yet.

**Common failures:** exceeding the plan's per-minute rate limit or monthly hash
quota throws `HashAnchorError`; read `.status` and `.body`. Call `getQuota()` to
see the limits attached to your key rather than assuming them.

### 3 · Then wait — this is the part that surprises people

The lifecycle is:

```
pending  →  batched  →  anchored          (or  failed)
```

Your hash waits for the next Merkle batch, that batch is anchored in one
transaction, and only then does a receipt exist. **The batching interval is a
service setting; on the managed deployment it is currently 15 minutes**, so a
first submission typically reaches `anchored` in roughly 15–20 minutes — not
seconds.

Until then:

```ts
await client.getReceipt(hash);
// HashAnchorError: Receipt not found   (.status === 404)
```

That 404 is **not a bug in your integration**. It is the correct answer to "is it
anchored yet?" asked too early. Poll `getStatus()` and fetch the receipt only once
the status is `anchored`:

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

/**
 * Wait for a hash to reach `anchored`, then return its receipt.
 * Exponential backoff, capped delay, overall deadline.
 */
async function waitUntilAnchored(
  client: HashAnchor,
  hash: string,
  { timeoutMs = 30 * 60_000, initialDelayMs = 5_000, maxDelayMs = 60_000 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;

  while (Date.now() < deadline) {
    const status = await client.getStatus(hash);

    if (status.status === "anchored") return client.getReceipt(hash);
    if (status.status === "failed") {
      throw new Error(`Anchoring failed for ${hash}`);
    }
    // "pending" or "batched" — keep waiting.

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, maxDelayMs);
  }

  throw new Error(`Timed out waiting for ${hash} to anchor`);
}

const receipt = await waitUntilAnchored(client, submitted.hash);
console.log(receipt.anchor.txHash);
```

For a long-running application, record the hash and sweep on a schedule instead of
holding a request open for 15 minutes. `batchStatus(hashes)` checks many hashes in
one call and is the right tool for that sweep.

### 4 · Verify

```ts
import { verifyReceiptProof } from "@tlay/hashanchor-client";

const receipt = await client.getReceipt(hash);
const included = verifyReceiptProof(receipt); // offline, no network
```

**Be precise about what this proves.** A valid inclusion proof establishes exactly
one thing: *these exact bytes hash to a leaf that sits under this Merkle root.*
Combined with the anchor transaction, it also establishes that the root existed no
later than that block.

It does **not** establish:

- **that the data is true.** A sensor that lies produces a perfectly anchored lie.
  Anchoring proves existence and integrity, never correctness.
- **who produced the data.** Authorship comes from a signature over the payload —
  which is what [BoAT MER](https://github.com/TLAY-IO/boat-mer) gives a device —
  not from anchoring.
- **that the data existed *before* it was submitted.** The timestamp you can prove
  is an upper bound: no later than the anchoring block.

**Offline inclusion is not on-chain verification.** `verifyReceiptProof()` never
touches a network, so it cannot tell you the root was really anchored. For that,
either call `client.verify(hash)` — the hosted service checks the anchor
transaction, and needs no API key — or read the anchor transaction yourself from
the chain named in the receipt. **If you need assurance that does not depend on
the service, do the latter**; it is the only option here that does not trust us.

Which chains a deployment anchors to is a property of that deployment, not of this
SDK, and it changes without a release here. **Call `getChains()` for the
authoritative list** rather than hardcoding one.

---

## Path B · Settle device-signed payments

The payment adapter targets **x402 V2 on EVM networks**. It reshapes the flat
proof emitted by an edge device into the Circle Gateway envelope expected by
`POST /v1/x402/settle`.

**The payer's private key never reaches HashAnchor.** The device signs, the SDK
preserves the signed fields verbatim, and the endpoint relays them. HashAnchor
holds no key, connects to no RPC node, and pays no gas — which is why this path
needs no API key.

```ts
import { HashAnchor } from "@tlay/hashanchor-client";

const ha = new HashAnchor(); // settle is a public endpoint

const results = await ha.settle({
  sid: "stream-1",
  batchIdx: 0,
  network: "eip155:5042002", // CAIP-2
  proofs: [
    {
      sig: "0x…",       // 0x + r || s || v   (v is the last byte, 27 or 28)
      from: "0x…",
      to: "0x…",
      value: "10",      // atomic units (µUSDC)
      validAfter: 1718200000,
      validBefore: 1718804900,
      nonce: "0x…",     // 32 bytes
      slice_id: 0,
    },
  ],
});
```

Expected shape — **one result per proof, positionally aligned with `proofs`**:

```json
[ { "success": true,  "payer": "0x…", "transaction": "…",
    "network": "eip155:5042002", "chainId": 5042002 } ]

[ { "success": false, "errorReason": "insufficient_balance",
    "network": "eip155:5042002", "chainId": 5042002 } ]
```

### Field types: what the SDK accepts vs what goes on the wire

These are **not the same**, and other documentation in this stack describes the
wire format, so the two can look contradictory. They are not:

| Field | SDK input type | On the wire | Notes |
|---|---|---|---|
| `value` | **string only** | string | Atomic units. Must be a string end to end. |
| `nonce` | **string only** | string | `0x` + 64 hex. Opaque; never a number. |
| `validAfter` | `number \| string` | **string** | The SDK stringifies it for you. |
| `validBefore` | `number \| string` | **string** | The SDK stringifies it for you. |
| `sig`, `from`, `to` | string | string | Carried verbatim. |
| `slice_id` | `number?` | — | Client-side idempotency only; not signed. |

So: **the wire payload is all strings; the SDK's convenience is limited to the two
validity timestamps.** It does not extend to `value` or `nonce`, and it cannot —
by the time a uint256 amount or a 32-byte nonce has been a JavaScript `number`, it
has already lost precision. The resulting signature recovers to the wrong payer,
and nothing in the rejection points at the cause.

### Error taxonomy: what to do with a failure

`settle()` **does not throw for a rejected payment.** It returns a result per
proof, so one failure never sinks the batch. Read every result.

| Outcome | How it looks | Safe to retry? |
|---|---|---|
| **Settled** | `success: true` with `transaction` | — |
| **Malformed request** (HTTP 400: bad JSON, undecodable payload, unsupported network) | `success: false`, `errorReason` describes the request | **Yes, after fixing it.** Nothing was submitted; this is not a settlement outcome. |
| **Provider rejection** (HTTP 402), e.g. `insufficient_balance`, `authorization_validity_too_short` | `success: false` with the provider's reason | **Only after fixing the stated cause.** The authorization was seen and refused. |
| **`nonce_already_used`** | `success: false` | **No — ambiguous.** See below. |
| **Transport fault** (connection reset, timeout) | `success: false`, `errorReason` is the transport error | **No, not blindly.** You do not know whether it landed. Reconcile first. |

`errorReason` is passed through from the settlement provider, so **treat it as an
open set** — match on the values you handle and fall through to reconciliation for
the rest.

🔴 **`nonce_already_used` is not a synonym for "already paid".** It proves the
authorization nonce was consumed — not *which* settlement consumed it, and not
that it was yours. Reconcile network, asset, payer, payee, and amount against the
provider or the chain before recording it as prior success. The same applies to
any transport fault: an unanswered request is proof of neither success nor
failure.

### Networks and boundaries

This release carries a canonical USDC address and Gateway contract for a set of
EVM networks, addressed by CAIP-2 identifier (`eip155:<chainId>`).

**What that mapping means is narrow: the SDK can build a well-formed request for
that network.** Whether a request is then *settled* is decided by the settlement
provider, not by this SDK — and the SDK cannot tell you the answer in advance. A
network you can address here may be unavailable, gated on account enablement, or
withdrawn, and that can change without any release of this package. **Confirm
current support with the settlement provider before you build on a network**, and
treat a rejection as a settlement outcome to reconcile, not as a bug in the SDK.

Pass the network explicitly on every envelope; there is no default.

Use `buildSettlePayload()` when you need the Circle-native request body without
the bundled HTTP client (custom transport, offline signer, test fixture). Before
implementing a signer, read the [settle envelope](./docs/settle-envelope.md) and
the [EIP-712 Gateway-domain guide](./docs/eip712-domain-trap.md) — the domain is
the most common source of signatures that verify locally and fail remotely.

---

## What ships today

| Capability | Status |
|---|---|
| Hash and content submission | Shipped |
| Merkle-batch status and portable receipts | Shipped |
| Offline Merkle inclusion verification | Shipped |
| x402 V2 settlement for EVM networks via Circle Gateway and USDC | Shipped |
| MPP / Tempo | In the hosted server; **not exposed by this SDK** |
| Other payment networks and assets | Roadmap; not shipped |

The product direction is provider-, protocol-, and asset-neutral; this release is
deliberately narrower. Circle, Arc, x402, and USDC are the first concrete
integration, **not the definition of the core product**. Other rails are roadmap
directions and are not claims about what this SDK does today.

## API surface

| Method | Auth | Path | Purpose |
|---|---|---|---|
| `new HashAnchor({ apiKey?, baseUrl? })` | — | — | Create a client. Default deployment: `https://hashanchor.xid.network`. |
| `HashAnchor.provision(name, options?)` | none | A | Create a hosted-service API key. |
| `anchor(content, options?)` | API key | A | Hash content and submit it. |
| `submitHash(hash, options?)` | API key | A | Submit a precomputed `0x` + 32-byte hash. |
| `submitBatch(items)` | API key | A | Submit up to 100 hashes at once. |
| `getStatus(hash)` | API key | A | Lifecycle state and anchor metadata. |
| `batchStatus(hashes)` | API key | A | Query many hashes in one call. |
| `getQuota()` | API key | A | Plan, quota, and rate limits for your key. |
| `getReceipt(hash)` | none | A | Portable receipt (**404 until anchored**). |
| `verify(hash)` | none | A | Ask the service to check the Merkle path and anchor tx. |
| `getChains()` | none | A | Anchoring chains the deployment advertises. |
| `settle(envelope)` | none | B | Relay x402 proofs; one result per proof. |
| `buildSettlePayload(proof, options)` | offline | B | Reshape one proof, no network call. |
| `verifyReceiptProof(receipt)` | offline | A | Verify an inclusion path locally. |

Authenticated HTTP errors throw `HashAnchorError`, carrying the status in
`.status` and the parsed body in `.body`. `settle()` is the deliberate exception,
for the reason given in its taxonomy above.

## Trust boundaries

- **The SDK is not a wallet.** It carries already-signed authorizations and never
  needs a payer private key.
- **The SDK is not a server.** Anchoring, provisioning, status, and the settlement
  relay all go through the configured `baseUrl`, which is a hosted deployment.
  There is no self-hosting path in this repository.
- **Offline inclusion is not on-chain verification**, and neither one says the
  underlying data is true.
- **Integration support is release-specific.** A network mapping here does not
  guarantee a provider accepts that network today.
- **Retry with evidence.** Transport failures and ambiguous nonce outcomes prove
  neither success nor failure; reconcile before acting.

## Documentation

- [API reference](./docs/api-reference.md)
- [Receipt and settle-envelope schema](./docs/settle-envelope.md)
- [Getting started on the hosted service](./docs/getting-started.md)
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
