# Sandbox Onboarding

Get from zero to a verified on-chain anchor in a few minutes.

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

Free tier: no email, no card. Limits: `100 req/min/key`, `10k req/day/key`, monthly hash
quota per plan.

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

## 3. Wait for the batch → on-chain anchor

Anchoring is asynchronous: hashes accumulate into a Merkle batch, the root is committed
on-chain on the batch interval, then your receipt is available. Poll:

```ts
let status;
do {
  await new Promise((r) => setTimeout(r, 5000));
  status = (await client.getStatus(hash)).status;
} while (status !== "anchored" && status !== "failed");
```

In production the batch interval is ~15 min; sandbox/self-host can be shorter.

## 4. Verify

```ts
const v = await client.verify(hash);          // checks proof + on-chain anchor
console.log(v.verified, v.anchor?.txHash);

const receipt = await client.getReceipt(hash);
import { verifyReceiptProof } from "@tlay/hashanchor-client";
console.log("offline proof ok:", verifyReceiptProof(receipt));
```

## Self-hosting

The client SDK (this repo) is Apache-2.0. The HashAnchor **server** (multi-tenant proxy,
on-chain anchoring worker, JWT/API-key auth) is operated by TLAY as a commercial service
and is not part of this repo. Point the SDK at any compatible deployment via `baseUrl`:

```ts
new HashAnchor({ apiKey, baseUrl: "https://your-hashanchor.example.com" });
```

## Paying per anchor (optional, x402)

For machine-to-machine nanopayments, HashAnchor exposes a stateless x402 facilitator at
`POST /v1/x402/settle`. Before integrating, read
[settle-envelope.md](./settle-envelope.md) and the
[EIP-712 Gateway-domain trap](./eip712-domain-trap.md).
