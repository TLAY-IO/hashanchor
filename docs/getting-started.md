# Getting started on the hosted service

Zero to a verified on-chain anchor. **Budget about 20 minutes** — most of it is
waiting for a Merkle batch to close, not work you do.

## 1. Get an API key (no signup)

```ts
import { HashAnchor } from "@tlay/hashanchor-client";
const { apiKey } = await HashAnchor.provision("my-app");
```

Or via curl:

```bash
curl -X POST https://hashanchor.xid.network/auth/provision \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app"}'
```

No email, no card. New keys land on the **free plan**: **10 requests per minute**
and **100 hashes per month**. There is no separate daily limit.

Limits are a property of the plan attached to your key and can change, so read
them rather than hardcoding them:

```ts
const { plan, quota } = await client.getQuota();
```

## 2. Anchor something

```ts
const client = new HashAnchor({ apiKey });
const { hash } = await client.anchor("my first anchored record");
```

```bash
curl -X POST https://hashanchor.xid.network/v1/hashes/anchor \
  -H "Authorization: Bearer $HASHANCHOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"my first anchored record"}'
```

This returns `{"status":"accepted", …}`. **Accepted is not anchored** — nothing is
on-chain yet.

## 3. Wait for the batch, then the on-chain anchor

Anchoring is asynchronous: hashes accumulate into a Merkle batch, the root is
committed on-chain when the batch closes, and only then does a receipt exist.
**On the hosted deployment the batch interval is currently 15 minutes**, so expect
roughly 15–20 minutes for a first anchor. The interval is a deployment setting,
not a guarantee.

Asking for the receipt before then returns HTTP 404 (`Receipt not found`). That is
the correct answer to a question asked too early, not an integration bug.

Poll status, with backoff and a deadline:

```ts
async function waitUntilAnchored(client, hash, {
  timeoutMs = 30 * 60_000, initialDelayMs = 5_000, maxDelayMs = 60_000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;

  while (Date.now() < deadline) {
    const { status } = await client.getStatus(hash);
    if (status === "anchored") return client.getReceipt(hash);
    if (status === "failed") throw new Error(`Anchoring failed for ${hash}`);

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, maxDelayMs);
  }
  throw new Error(`Timed out waiting for ${hash} to anchor`);
}
```

A fixed 5-second loop with no ceiling will spend your rate limit on waiting. On
the free plan's 10 requests per minute, that matters.

## 4. Verify

```ts
const v = await client.verify(hash);          // service checks proof + anchor tx
console.log(v.verified, v.anchor?.txHash);

import { verifyReceiptProof } from "@tlay/hashanchor-client";
const receipt = await client.getReceipt(hash);
console.log("offline proof ok:", verifyReceiptProof(receipt));
```

`verify()` trusts the service. `verifyReceiptProof()` runs locally and proves only
that the leaf sits under the stated root — it does not confirm the root was
anchored. For assurance that depends on neither, read the anchor transaction
yourself from the chain named in the receipt.

## Pointing the SDK at a different deployment

The client SDK (this repository) is Apache-2.0. The HashAnchor **server** —
multi-tenant proxy, on-chain anchoring worker, JWT/API-key auth — is operated by
TLAY as a commercial service and is **not part of this repository**. Cloning this
repository does not give you a server to run.

If you have access to another compatible deployment, point the SDK at it:

```ts
new HashAnchor({ apiKey, baseUrl: "https://your-hashanchor.example.com" });
```

## Paying per anchor (optional, x402)

For machine-to-machine nanopayments, HashAnchor exposes a stateless x402
facilitator at `POST /v1/x402/settle` (no API key). Before integrating, read
[settle-envelope.md](./settle-envelope.md) and the
[EIP-712 Gateway-domain trap](./eip712-domain-trap.md).
