# ⚠️ The EIP-712 Gateway-Domain Trap

> **TL;DR** When paying through HashAnchor's x402 nanopayment path (`/v1/x402/settle`,
> Circle Gateway), you sign the authorization against the **Circle Gateway's** EIP-712
> domain — **not** the USDC token's domain. Signing against the USDC token domain is the
> single most common integration bug and surfaces as `address_mismatch` /
> `invalid_signature` at settle time. The signature is cryptographically valid; it just
> recovers a signer for the *wrong* domain.

## Why there are two domains

HashAnchor exposes two payment surfaces, and they verify against **different** EIP-712
domains. This is the root of the confusion.

### 1. Legacy direct EIP-3009 (on-chain `transferWithAuthorization`)

The classic USDC EIP-3009 flow. The signing domain is the **USDC token contract** itself:

```js
const domain = {
  name: "USD Coin",        // the token's EIP-712 name
  version: "2",
  chainId: <chain id>,
  verifyingContract: <USDC token contract address>,
};
const types = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
};
```

This is what HashAnchor's server verifies for `PAYMENT_MODE=legacy`. If you are using the
legacy direct path, the USDC-token domain above is correct.

### 2. x402 nanopayment via Circle Gateway (`/v1/x402/settle`)

The batched, gasless path. Here the authorization is consumed by **Circle's Gateway**,
which verifies it against the **Gateway's own EIP-712 domain** — different `name` and
different `verifyingContract` (the Gateway contract, not the USDC token). HashAnchor is a
**stateless relay** here: it forwards your `paymentPayload` + `paymentRequirements` to
Circle and returns the verdict. It does **not** re-sign or re-verify against the token
domain — so a token-domain signature passes HashAnchor and fails *at Circle*.

If you sign with `name: "USD Coin"` / `verifyingContract: <USDC>` and submit it to the
Gateway path, Circle recovers a signer that doesn't match `from` → `address_mismatch`.

## The fix

Build the EIP-712 domain from the **Gateway's** parameters for the target network, not
from the USDC token. Take the domain (`name`, `version`, `chainId`, `verifyingContract`)
from Circle's Gateway spec / the `paymentRequirements` you were handed — do **not**
hardcode `"USD Coin"` and the token address for this path.

## Three more Gateway gotchas (seen in production)

1. **Low-s normalization.** Circle rejects non-canonical signatures. Normalize `s` to the
   lower half of the curve order (EIP-2 low-s) before submitting.
2. **Authorization validity window.** A window that's valid for an immediate on-chain
   `transferWithAuthorization` can be **too short** for Gateway batching →
   `authorization_validity_too_short`. Give `validBefore - validAfter` enough headroom
   (hours, not seconds).
3. **Nonce reuse is idempotent, not fatal.** Re-submitting the same `(payer, nonce)`
   returns `nonce_already_used`. Under at-least-once transports (MQTT QoS1, BLE slice
   retransmit) this is expected and means "already settled" — de-dup client-side rather
   than treating it as a failed payment.

## Checklist before you ship an x402 integration

- [ ] Domain comes from the **Gateway**, not the USDC token (`name` ≠ `"USD Coin"` here).
- [ ] `s` is low-s normalized.
- [ ] Validity window is generous enough for batching.
- [ ] `(payer, nonce)` de-dup so retransmits don't look like failures.
- [ ] Payer has `approve`+`deposit`ed into the Gateway (else `insufficient_balance`).
- [ ] `paymentRequirements.network` is a network Circle's Gateway actually supports.
