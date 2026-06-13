# HashAnchor API Reference

Base URL (production): `https://hashanchor.xid.network`

Authentication: most write endpoints require an API key sent as `Authorization: Bearer ha_…`.
Verification/read endpoints (`/v1/verify`, `/v1/receipts`, `/v1/chains`) are public.

## Provisioning

### `POST /auth/provision`
Self-serve a free API key. No auth.

```json
// request
{ "name": "my-app", "email": "optional@example.com" }
// response
{ "tenantId": "...", "apiKey": "ha_...", "plan": "free",
  "quota": { "limit": 100, "remaining": 100 } }
```

## Anchoring

### `POST /v1/hashes/anchor` — anchor raw content
Server computes the hash for you.
```json
{ "content": "hello", "format": "text", "metadata": {}, "externalId": "..." }
```
`format`: `text` (default) or `base64`. Returns `{ status, id, hash, metadata }`.

### `POST /v1/hashes` — submit a precomputed hash
```json
{ "hash": "0x<64 hex>", "metadata": {}, "externalId": "..." }
```
`hash` must be `0x` + 32 bytes (64 hex). Returns `{ status: "accepted"|"duplicate", id, hash }`.

### `POST /v1/hashes/batch` — submit up to 100 hashes
```json
{ "hashes": [ { "hash": "0x…", "externalId": "...", "metadata": {} } ] }
```
Returns `{ accepted, duplicates, results[] }`.

## Queries

| Endpoint | Auth | Returns |
|----------|------|---------|
| `GET /v1/hashes/:hash` | key | Full status incl. `batch` and `anchor` once available. |
| `POST /v1/hashes/status` | key | `{ results: [{ hash, status, txHash?, blockTimestamp? }] }` |
| `GET /v1/quota` | key | `{ plan, monthly: { limit, used, remaining }, rateLimit }` |

Lifecycle: `pending → batched → anchored` (or `failed`). Anchoring is asynchronous —
hashes are accumulated into a Merkle batch, the root is committed on-chain, then the
per-hash receipt becomes available.

## Public verification

| Endpoint | Returns |
|----------|---------|
| `GET /v1/verify/:hash` | `{ verified, status, hash, anchor: { txHash, blockNumber, blockTimestamp, chainId, contractAddress } }` — checks the Merkle proof **and** the on-chain anchor. |
| `GET /v1/receipts/:hash` | Portable JSON receipt (see [settle-envelope.md](./settle-envelope.md)). |
| `GET /v1/chains` | Supported anchoring chains `[{ id, name, chainId }]`. |

## Errors

All non-2xx responses are JSON `{ "error": "..." }`. The SDK surfaces these as
`HashAnchorError` with `.status` (HTTP code) and `.body` (parsed payload).

Free-tier limits (production default): `100 req/min/key`, `10k req/day/key`, monthly hash quota per plan.
