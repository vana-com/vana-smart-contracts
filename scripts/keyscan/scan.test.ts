import { expect } from "chai";
import {
  PUBLISHED_CONSTANTS,
  addContext,
  deriveAddress,
  extractFromLine,
  isPeriodic,
  isPlausibleKey,
  looksLikeSecretContext,
  parseRpcUrls,
  parseUnifiedDiff,
  redact,
  safeDisplayName,
  sanitizeError,
  scan,
  scanIncomplete,
} from "./scan";

/**
 * These tests need no network and no chain: `scan` takes its chains as an
 * argument, so passing none exercises every rule except liveness.
 */

// Invented for these tests and used nowhere. Deliberately NOT a Hardhat account:
// those are excluded as public values, so they cannot exercise the scan rules.
const SAMPLE_KEY =
  "0xd1e5b1a0f6c8e3a94b7f2c5d8e0a3f6b9c2d5e8f1a4b7c0d3e6f9a2b5c8d1e4f";
const SAMPLE_ADDRESS = "0x0ceb6d5e139c6f79AB76D69a0d81D4adE23f0F3b";

// Hardhat / Anvil account #0 — the most widely shared key in Ethereum.
const HARDHAT_ACCOUNT_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("keyscan/isPlausibleKey", () => {
  it("rejects zero and values below the entropy bound", () => {
    expect(isPlausibleKey("0".repeat(64))).to.equal(false);
    expect(isPlausibleKey("0".repeat(63) + "1")).to.equal(false);
    // 2^128 - 1: the largest value still too small to be a real key.
    expect(isPlausibleKey("0".repeat(32) + "f".repeat(32))).to.equal(false);
  });

  it("rejects values at or above the curve order", () => {
    expect(isPlausibleKey("f".repeat(64))).to.equal(false);
    expect(
      isPlausibleKey(
        "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
      ),
    ).to.equal(false);
  });

  it("accepts a real key", () => {
    expect(isPlausibleKey(SAMPLE_KEY.slice(2))).to.equal(true);
  });
});

describe("keyscan/deriveAddress", () => {
  it("derives the address the key controls", () => {
    expect(deriveAddress(SAMPLE_KEY)).to.equal(SAMPLE_ADDRESS);
  });
});

describe("keyscan/extractFromLine", () => {
  it("finds a candidate with or without the 0x prefix", () => {
    expect(extractFromLine(`key = "${SAMPLE_KEY}"`, "a.ts", 1)).to.have.length(1);
    expect(
      extractFromLine(`key = "${SAMPLE_KEY.slice(2)}"`, "a.ts", 1),
    ).to.have.length(1);
  });

  it("normalises to a lowercase 0x-prefixed key", () => {
    const [found] = extractFromLine(SAMPLE_KEY.toUpperCase(), "a.ts", 7);
    expect(found.key).to.equal(SAMPLE_KEY);
    expect(found.line).to.equal(7);
  });

  it("does not slice longer hex blobs into 64-char windows", () => {
    // 128 hex = uncompressed public key, 192 hex = BLS signature. Neither is a
    // key, and neither should yield a candidate.
    expect(extractFromLine(`0x${"a".repeat(128)}`, "a.ts", 1)).to.have.length(0);
    expect(extractFromLine(`0x${"a".repeat(192)}`, "a.ts", 1)).to.have.length(0);
  });

  it("ignores ABI-encoded small integers", () => {
    expect(extractFromLine(`0x${"0".repeat(63)}1`, "a.ts", 1)).to.have.length(0);
    expect(extractFromLine(`0x${"0".repeat(62)}20`, "a.ts", 1)).to.have.length(0);
  });

  it("finds every candidate on a line, not just the first", () => {
    const second =
      "0x7c4a8d09ca3762af61e59520943dc26494f8941b9b1f0c3ea6d4e2b8f5a09c73";
    expect(extractFromLine(`${SAMPLE_KEY} ${second}`, "a.ts", 1)).to.have.length(2);
  });

  it("ignores hand-typed placeholder keys that repeat a short pattern", () => {
    const placeholder = "1234567890abcdef".repeat(4);
    expect(isPeriodic(placeholder)).to.equal(true);
    expect(extractFromLine(`0x${placeholder}`, "a.ts", 1)).to.have.length(0);
    expect(extractFromLine(`0x${"b".repeat(64)}`, "a.ts", 1)).to.have.length(0);
    // A real key is not periodic.
    expect(isPeriodic(SAMPLE_KEY.slice(2))).to.equal(false);
  });
});

describe("keyscan/addContext", () => {
  it("sees a secret name declared on the line above the value", () => {
    // The shape that caused the real incident: the name is on one line and the
    // key on the next, so a line-scoped check sees only a quoted string.
    const targets = addContext([
      { file: "a.ts", line: 136, text: "const FUNDER_PRIVATE_KEY = (process.env[x] ??" },
      { file: "a.ts", line: 137, text: `  "${SAMPLE_KEY}") as Hex;` },
    ]);
    const keyLine = targets.find((t) => t.line === 137)!;
    expect(keyLine.context).to.contain("FUNDER_PRIVATE_KEY");
    expect(looksLikeSecretContext(keyLine.context!, keyLine.file)).to.equal(true);
  });

  it("does not join lines that are far apart", () => {
    const targets = addContext([
      { file: "a.ts", line: 1, text: "const privateKey =" },
      { file: "a.ts", line: 400, text: SAMPLE_KEY },
    ]);
    const keyLine = targets.find((t) => t.line === 400)!;
    expect(keyLine.context ?? "").to.not.contain("privateKey");
  });

  it("leaves lines without a candidate untouched", () => {
    const targets = addContext([{ file: "a.ts", line: 1, text: "no key here" }]);
    expect(targets[0].context).to.equal(undefined);
  });
});

describe("keyscan/looksLikeSecretContext", () => {
  it("recognises secret-shaped lines and paths", () => {
    expect(looksLikeSecretContext("const privateKey =", "a.ts")).to.equal(true);
    expect(looksLikeSecretContext("DEPLOYER_PRIVATE_KEY=x", "a.ts")).to.equal(true);
    expect(looksLikeSecretContext("value", "config/.env.local")).to.equal(true);
  });

  it("recognises a secrets directory, not just a secrets file", () => {
    expect(looksLikeSecretContext("value", "config/secrets/prod.json")).to.equal(
      true,
    );
    expect(looksLikeSecretContext("value", "secret/keys.json")).to.equal(true);
  });

  it("does not fire on ordinary code", () => {
    expect(looksLikeSecretContext("const merkleRoot =", "a.ts")).to.equal(false);
  });
});

describe("keyscan/redact", () => {
  it("never emits the whole key", () => {
    const masked = redact(SAMPLE_KEY);
    expect(masked).to.not.contain(SAMPLE_KEY.slice(10, 60));
    expect(masked.length).to.be.lessThan(SAMPLE_KEY.length);
  });
});

describe("keyscan/safeDisplayName", () => {
  it("reduces an unnamed endpoint to its hostname", () => {
    // Provider URLs carry API keys in the path, and chain names reach CI logs.
    expect(safeDisplayName("https://foo.quiknode.pro/deadbeefsecret/")).to.equal(
      "foo.quiknode.pro",
    );
  });

  it("does not fall back to echoing an unparseable url", () => {
    expect(safeDisplayName("not a url")).to.equal("unnamed-rpc");
  });

  it("names endpoints from the environment without leaking the path", () => {
    const [chain] = parseRpcUrls("https://rpc.example.org/key/abc123");
    expect(chain.name).to.equal("rpc.example.org");
  });

  it("keeps an explicit name when one is given", () => {
    const [chain] = parseRpcUrls("vana=https://rpc.example.org/key/abc123");
    expect(chain.name).to.equal("vana");
  });
});

describe("keyscan/sanitizeError", () => {
  it("strips the API key out of a provider error message", () => {
    // ethers formats failures with the whole FetchRequest URL, so a 429 from a
    // private endpoint carries the key in error.message.
    const message = sanitizeError(
      new Error(
        'could not coalesce error (payload={"method":"eth_getBalance"}, url=https://foo.quiknode.pro/SECRETKEY123/ )',
      ),
    );
    expect(message).to.not.contain("SECRETKEY123");
    expect(message).to.contain("foo.quiknode.pro");
  });

  it("truncates so a provider payload cannot be dumped whole", () => {
    expect(sanitizeError(new Error("x".repeat(5000))).length).to.be.at.most(201);
  });

  it("handles non-Error throws", () => {
    expect(sanitizeError("plain string")).to.equal("plain string");
  });
});

describe("keyscan/scanIncomplete", () => {
  const base = {
    candidates: 0,
    distinctKeys: 0,
    publishedConstants: 0,
    findings: [],
  };

  it("treats a missing liveness check as incomplete", () => {
    expect(
      scanIncomplete({ ...base, chainStatus: [], livenessChecked: false }),
    ).to.equal(true);
  });

  it("treats a failed chain as incomplete even with no findings", () => {
    // The failure mode this guards: a rate-limited RPC makes a funded leaked
    // key produce no finding, which is indistinguishable from a clean run.
    expect(
      scanIncomplete({
        ...base,
        chainStatus: [{ name: "vana", ok: false, error: "429" }],
        livenessChecked: true,
      }),
    ).to.equal(true);
  });

  it("is complete when every chain answered", () => {
    expect(
      scanIncomplete({
        ...base,
        chainStatus: [{ name: "vana", ok: true }],
        livenessChecked: true,
      }),
    ).to.equal(false);
  });
});

describe("keyscan/parseUnifiedDiff", () => {
  it("attributes added lines to the right file and line number", () => {
    const diff = [
      "diff --git a/scripts/a.ts b/scripts/a.ts",
      "--- a/scripts/a.ts",
      "+++ b/scripts/a.ts",
      "@@ -0,0 +12,2 @@",
      "+first",
      "+second",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -3,0 +4 @@",
      "+only",
    ].join("\n");

    expect(parseUnifiedDiff(diff)).to.deep.equal([
      { file: "scripts/a.ts", line: 12, text: "first" },
      { file: "scripts/a.ts", line: 13, text: "second" },
      { file: "b.ts", line: 4, text: "only" },
    ]);
  });

  it("ignores removed lines", () => {
    const diff = [
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-gone",
      "+kept",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).to.deep.equal([
      { file: "a.ts", line: 1, text: "kept" },
    ]);
  });
});

describe("keyscan/scan", () => {
  const noChains: never[] = [];
  const noRegistry = new Set<string>();

  it("reports nothing for a key with no supporting signal", async () => {
    const result = await scan(
      [{ file: "a.ts", line: 1, text: SAMPLE_KEY }],
      noChains,
      noRegistry,
    );
    expect(result.distinctKeys).to.equal(1);
    expect(result.findings).to.have.length(0);
  });

  it("flags a key in a secret-shaped line as suspicious", async () => {
    const result = await scan(
      [{ file: "a.ts", line: 1, text: `const privateKey = "${SAMPLE_KEY}"` }],
      noChains,
      noRegistry,
    );
    expect(result.findings).to.have.length(1);
    expect(result.findings[0].severity).to.equal("suspicious");
    expect(result.findings[0].address).to.equal(SAMPLE_ADDRESS);
  });

  it("treats a key deriving to a registered address as critical", async () => {
    const result = await scan(
      [{ file: "a.ts", line: 1, text: SAMPLE_KEY }],
      noChains,
      new Set([SAMPLE_ADDRESS.toLowerCase()]),
    );
    expect(result.findings).to.have.length(1);
    expect(result.findings[0].severity).to.equal("critical");
  });

  it("excludes published constants before deriving anything", async () => {
    const slot = [...PUBLISHED_CONSTANTS][0];
    const result = await scan(
      [{ file: "Proxy.sol", line: 1, text: `bytes32 SLOT = ${slot};` }],
      noChains,
      noRegistry,
    );
    expect(result.publishedConstants).to.equal(1);
    expect(result.findings).to.have.length(0);
  });

  it("excludes shared development accounts even in a secret-shaped line", async () => {
    // Hardhat account #0 has on-chain history everywhere, including Vana and
    // Moksha. Without this exclusion every test fixture in the repo reports.
    expect(PUBLISHED_CONSTANTS.has(HARDHAT_ACCOUNT_0)).to.equal(true);
    const result = await scan(
      [
        {
          file: "test/fixture.ts",
          line: 1,
          text: `const privateKey = "${HARDHAT_ACCOUNT_0}"`,
        },
      ],
      noChains,
      noRegistry,
    );
    expect(result.publishedConstants).to.equal(1);
    expect(result.findings).to.have.length(0);
  });

  it("does not open a finding on breadth alone", async () => {
    // The same value in many files is a shared constant. With no other signal
    // it must stay silent, or every ABI blob in the tree becomes a finding.
    const targets = ["a.ts", "b.ts", "c.ts", "d.ts"].map((file) => ({
      file,
      line: 1,
      text: SAMPLE_KEY,
    }));
    const result = await scan(targets, noChains, noRegistry);
    expect(result.findings).to.have.length(0);
  });

  it("downgrades a registered key that is spread across many files", async () => {
    const targets = ["a.ts", "b.ts", "c.ts"].map((file) => ({
      file,
      line: 1,
      text: `const privateKey = "${SAMPLE_KEY}"`,
    }));
    const result = await scan(targets, noChains, noRegistry);
    expect(result.findings).to.have.length(3);
    expect(result.findings[0].severity).to.equal("suspicious");
    expect(result.findings[0].reasons.join(" ")).to.contain("downgraded");
  });

  it("respects an explicit keyscan:allow marker", async () => {
    const result = await scan(
      [
        {
          file: "a.ts",
          line: 1,
          text: `const privateKey = "${SAMPLE_KEY}" // keyscan: allow — dummy`,
        },
      ],
      noChains,
      noRegistry,
    );
    expect(result.findings).to.have.length(0);
  });

  it("emits one finding per location, not per occurrence on a line", async () => {
    const result = await scan(
      [
        {
          file: "a.ts",
          line: 4,
          text: `privateKey: ["${SAMPLE_KEY}", "${SAMPLE_KEY}"]`,
        },
      ],
      noChains,
      noRegistry,
    );
    expect(result.findings).to.have.length(1);
  });
});
