// Run: HASHANCHOR_API_KEY=ha_xxx node examples/quickstart.mjs
// (or omit the key and let the script provision a free one)
import { HashAnchor, verifyReceiptProof } from "@tlay/hashanchor-client";

let apiKey = process.env.HASHANCHOR_API_KEY;
if (!apiKey) {
  const p = await HashAnchor.provision("hashanchor-quickstart");
  apiKey = p.apiKey;
  console.log("Provisioned free key:", apiKey, "| plan:", p.plan);
}

const client = new HashAnchor({ apiKey });

const res = await client.anchor(`hello @ ${new Date().toISOString()}`);
console.log("Anchored:", res.hash, "status:", res.status);

const status = await client.getStatus(res.hash);
console.log("Lifecycle status:", status.status);

// Anchoring is asynchronous (batched, then committed on-chain). Poll getStatus
// or verify() until status === "anchored", then the receipt proof is available.
if (status.status === "anchored") {
  const receipt = await client.getReceipt(res.hash);
  console.log("Receipt proof valid offline:", verifyReceiptProof(receipt));
}
