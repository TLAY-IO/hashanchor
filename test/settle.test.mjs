// Tests for the x402 settle path. Run against the compiled dist with Node's
// built-in test runner: `node --test test/` (no extra dependency).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HashAnchor, buildSettlePayload, HashAnchorError } from "../dist/index.js";

// A frozen flat 0xEE04 wire proof. `value` is deliberately larger than 2^53 to
// prove the SDK never coerces it through a JS number.
const BIG_VALUE = "9007199254740993"; // 2^53 + 1, lossless only as string/BigInt
const PROOF = {
  sig: "0x" + "11".repeat(32) + "22".repeat(32) + "1c", // r||s||v, v=0x1c=28
  from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  value: BIG_VALUE,
  validAfter: 1718200000,
  validBefore: 1718203600,
  nonce: "0x" + "ab".repeat(32),
  slice_id: 7,
};
const NETWORK = "eip155:5042002"; // Arc Testnet

function decode(req) {
  return JSON.parse(Buffer.from(req.paymentPayload, "base64").toString("utf-8"));
}

test("buildSettlePayload nests flat proof into NanopaymentPayload", () => {
  const req = buildSettlePayload(PROOF, { network: NETWORK });
  assert.equal(req.x402Version, 2);
  const nano = decode(req);
  assert.equal(nano.x402Version, 2);
  assert.equal(nano.payload.signature, PROOF.sig); // sig -> payload.signature
  const a = nano.payload.authorization;
  assert.equal(a.from, PROOF.from);
  assert.equal(a.to, PROOF.to);
  assert.equal(a.nonce, PROOF.nonce);
});

test("value and nonce are carried verbatim with no precision loss", () => {
  const nano = decode(buildSettlePayload(PROOF, { network: NETWORK }));
  assert.equal(nano.payload.authorization.value, BIG_VALUE);
  assert.equal(typeof nano.payload.authorization.value, "string");
  // round-tripping through Number would corrupt this; assert it did not.
  assert.notEqual(nano.payload.authorization.value, String(Number(BIG_VALUE)));
  assert.equal(BigInt(nano.payload.authorization.value), BigInt(BIG_VALUE));
});

test("validAfter/validBefore are stringified", () => {
  const a = decode(buildSettlePayload(PROOF, { network: NETWORK })).payload
    .authorization;
  assert.equal(a.validAfter, "1718200000");
  assert.equal(a.validBefore, "1718203600");
  assert.equal(typeof a.validAfter, "string");
  assert.equal(typeof a.validBefore, "string");
});

test("v is the last byte of sig and stays 27/28", () => {
  const sig = decode(buildSettlePayload(PROOF, { network: NETWORK })).payload
    .signature;
  const v = parseInt(sig.slice(130, 132), 16);
  assert.equal(v, 28);
});

test("slice_id goes to paymentRequirements.extra, not authorization", () => {
  const req = buildSettlePayload(PROOF, { network: NETWORK });
  assert.equal(req.paymentRequirements.extra.sliceId, 7);
  assert.equal(decode(req).payload.authorization.slice_id, undefined);
});

test("asset defaults to canonical USDC for the network", () => {
  const req = buildSettlePayload(PROOF, { network: NETWORK });
  assert.equal(
    req.paymentRequirements.asset,
    "0x3600000000000000000000000000000000000000"
  );
  assert.equal(req.paymentRequirements.network, NETWORK);
  assert.equal(req.paymentRequirements.payTo, PROOF.to);
  const custom = buildSettlePayload(PROOF, { network: NETWORK, asset: "0xdead" });
  assert.equal(custom.paymentRequirements.asset, "0xdead");
});

test("settle() returns results positionally aligned with proofs", async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      status: 200,
      json: async () => ({ success: true, transaction: "0xtx", payer: PROOF.from }),
    };
  };
  const ha = new HashAnchor(); // no API key needed for settle
  const results = await ha.settle({
    sid: "s1",
    batchIdx: 0,
    network: NETWORK,
    proofs: [PROOF, { ...PROOF, nonce: "0x" + "cd".repeat(32) }],
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].success, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/v1\/x402\/settle$/);
  assert.equal(calls[0].body.x402Version, 2);
});

test("settle() treats HTTP 402 as a result (nonce_already_used), not a throw", async () => {
  global.fetch = async () => ({
    status: 402,
    json: async () => ({ success: false, errorReason: "nonce_already_used" }),
  });
  const ha = new HashAnchor();
  const [r] = await ha.settle({
    sid: "s",
    batchIdx: 0,
    network: NETWORK,
    proofs: [PROOF],
  });
  assert.equal(r.success, false);
  assert.equal(r.errorReason, "nonce_already_used");
});

test("settle() isolates a transport fault to one proof", async () => {
  let n = 0;
  global.fetch = async () => {
    n += 1;
    if (n === 1) throw new Error("ECONNRESET");
    return { status: 200, json: async () => ({ success: true }) };
  };
  const ha = new HashAnchor();
  const results = await ha.settle({
    sid: "s",
    batchIdx: 0,
    network: NETWORK,
    proofs: [PROOF, { ...PROOF, nonce: "0x" + "ef".repeat(32) }],
  });
  assert.equal(results[0].success, false);
  assert.match(results[0].errorReason, /ECONNRESET/);
  assert.equal(results[1].success, true);
});

test("authenticated methods throw without an API key", async () => {
  const ha = new HashAnchor();
  await assert.rejects(() => ha.submitHash("0x" + "00".repeat(32)), HashAnchorError);
});
