# Receipt & x402 Settle Envelope Schemas

This document defines two wire formats produced/consumed by HashAnchor:

1. **Anchor receipt** — the proof object you get from `GET /v1/receipts/:hash`.
2. **x402 settle envelope** — the request body for `POST /v1/x402/settle`, the public
   stateless facilitator endpoint used for device-to-device nanopayments.

---

## 1. Anchor receipt

```jsonc
{
  "@context": "https://hashanchor.io/receipt/v1",
  "hash": "0x<32-byte leaf>",
  "merkleRoot": "0x<32-byte root>",
  "proof": [
    { "position": "left" | "right", "data": "0x<32-byte sibling>" }
  ],
  "anchor": {
    "chainId": 137,
    "contractAddress": "0x<HashAnchor contract>",
    "txHash": "0x<anchor tx>",
    "blockNumber": 12345678,
    "blockTimestamp": 1718200000
  },
  "signature": "0x…"   // optional server attestation over the fields above
}
```

**Verification (two independent layers):**

- *Inclusion (offline):* `verifyReceiptProof(receipt)` in this SDK recomputes the
  Merkle path with **keccak256 + sorted pairs** and checks `leaf → merkleRoot`. No network.
- *Anchoring (on-chain):* confirm `merkleRoot` was committed by reading the HashAnchor
  contract at `anchor.contractAddress` / `anchor.txHash`. `GET /v1/verify/:hash` does both.

The `merkleRoot` is built with sorted-pair keccak256, so proofs are compatible with
OpenZeppelin `MerkleProof.verify` on-chain.

---

## 2. x402 settle envelope — `POST /v1/x402/settle`

Public, no auth. A **stateless relay**: HashAnchor forwards the caller's payment to the
Circle Gateway facilitator and returns the result. HashAnchor holds **no private key**,
connects to **no RPC**, and pays **no gas** — Circle executes the on-chain burn/mint from
the payer's Gateway deposit.

### Request

```jsonc
{
  "x402Version": 2,
  "paymentPayload": "<base64-encoded NanopaymentPayload JSON>",
  "paymentRequirements": {
    "network": "eip155:5042002",      // REQUIRED — reverse-mapped to a supported chain
    "scheme": "exact",                // optional
    "asset": "0x<USDC contract>",     // optional
    "amount": "10",                   // optional, atomic units
    "payTo": "0x<seller>",            // optional
    "maxTimeoutSeconds": 60,          // optional
    "extra": {}                       // optional, passed through
  }
}
```

- `paymentPayload` base64-decodes to a JSON object whose
  `payload.authorization.from` is the payer address.
- `paymentRequirements` is passed **through to Circle unchanged** — HashAnchor does not
  rebuild it (this is deliberate; rebuilding would overwrite `payTo` with the server's
  own wallet). You are responsible for a correct, Gateway-valid `paymentRequirements`.
- `network` must be one of HashAnchor's supported chains, e.g.
  `eip155:137` (Polygon), `eip155:8453` (Base), `eip155:5042002` (Arc Testnet),
  `eip155:84532` (Base Sepolia). Unknown network → `400 { success:false, errorReason }`.

### Response

```jsonc
{
  "success": true,
  "payer": "0x…",
  "transaction": "0x<settle tx>",   // present on success
  "network": "eip155:5042002",
  "errorReason": null,
  "chainId": 5042002
}
```

HTTP `200` on `success:true`, `402` on `success:false`.

### Common `errorReason` values (from Circle Gateway)

| errorReason | Meaning / fix |
|-------------|---------------|
| `nonce_already_used` | Idempotent rejection — this authorization was already settled. **Not a real failure** under at-least-once delivery (MQTT QoS1 / retransmit). De-dup on `(payer, nonce)` client-side. |
| `insufficient_balance` | Payer hasn't `approve`+`deposit`ed USDC into the Gateway contract. |
| `authorization_validity_too_short` | The signed validity window is too short for Gateway batching — widen `validBefore - validAfter`. |
| `address_mismatch` / `invalid_signature` | Signed against the wrong EIP-712 domain. **See [eip712-domain-trap.md](./eip712-domain-trap.md).** |
| `unsupported_domain` | Circle's Gateway hasn't registered this network yet (independent of HashAnchor). |
