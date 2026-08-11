/**
 * keyscan — find leaked EOA private keys by deriving them, not by matching them.
 *
 * Why not a regex:
 *   An Ethereum private key has no structure. It is 32 uniformly random bytes:
 *   no checksum, no version byte, no prefix, no length that distinguishes it
 *   from anything else. So the only pattern available is `(0x)?[0-9a-f]{64}`,
 *   and in this repository that pattern also matches transaction hashes, block
 *   hashes, every keccak256/sha256 digest, merkle and state roots, storage
 *   slots, ABI-encoded 32-byte words, salts, commitments, and the
 *   `deposit_data_root` / `withdrawal_credentials` fields in validator deposit
 *   data. 32-byte hex *is* the native unit of this codebase, which is why
 *   shape-matching scanners produce far more noise than signal here.
 *
 * What this does instead:
 *   For each 64-hex candidate, derive the address that key would control and
 *   ask the chain whether that address has ever been used. A digest derives to
 *   an address with no nonce, no balance and no history. A real leaked key does
 *   not. That turns an unusable shape heuristic into a near-zero-false-positive
 *   check, using context a generic secret scanner does not have: our own chain.
 *
 * Why liveness alone is not enough:
 *   Published 32-byte constants — the EIP-1967 proxy slots above all — are
 *   valid scalars that anyone can derive, and people have: the address behind
 *   the EIP-1967 implementation slot has a non-zero nonce on Moksha. Since that
 *   slot appears in every proxy deployment file we publish, treating "has
 *   on-chain history" as sufficient turns one constant into hundreds of
 *   findings. Two rules keep that out: a denylist of published constants
 *   (derived here from their definitions, so it cannot drift), and the
 *   observation that a value repeated across many files is a shared constant,
 *   whereas a leaked key is a one-off accident.
 *
 * Blind spot, and the mitigation:
 *   A freshly generated key that was never funded derives to an address with no
 *   history, so liveness alone will miss it. Two secondary signals cover that
 *   tail: an optional register of known Vana addresses, and a check on whether
 *   the surrounding filename or line looks like it is naming a secret.
 *
 * Usage:
 *   npx ts-node scripts/keyscan/scan.ts --diff origin/main...HEAD
 *   npx ts-node scripts/keyscan/scan.ts --all
 *   npx ts-node scripts/keyscan/scan.ts --diff origin/main...HEAD --json
 *
 * Environment:
 *   KEYSCAN_RPC_URLS         Comma-separated RPC endpoints, each `name=url` or a
 *                            bare url. Liveness checks are skipped if unset.
 *                            Prefer our own node over a public endpoint.
 *   KEYSCAN_ADDRESS_REGISTRY Optional path to a JSON file holding known Vana
 *                            addresses (array of strings, or an object keyed by
 *                            address). A candidate deriving to a registered
 *                            address is reported even with no chain history.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  HDNodeWallet,
  JsonRpcProvider,
  Mnemonic,
  SigningKey,
  computeAddress,
  getAddress,
  id,
  keccak256,
} from "ethers";

/** Order of the secp256k1 curve. A valid private key is in [1, N-1]. */
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** `keccak256(text) - 1`, the shape every EIP-1967 storage slot is defined by. */
function slotMinusOne(text: string): string {
  return `0x${(BigInt(id(text)) - 1n).toString(16).padStart(64, "0")}`;
}

/**
 * The mnemonic every Hardhat and Anvil node starts with. Its accounts are the
 * most widely shared keys in Ethereum, so they turn up in fixtures everywhere
 * and their addresses have been used on every chain that exists.
 */
const DEV_MNEMONIC =
  "test test test test test test test test test test test junk";
const DEV_ACCOUNTS = 20;

function developmentKeys(): string[] {
  // Build the seed once, then derive siblings from it.
  const mnemonic = Mnemonic.fromPhrase(DEV_MNEMONIC);
  return Array.from({ length: DEV_ACCOUNTS }, (_unused, index) =>
    HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`).privateKey.toLowerCase(),
  );
}

/**
 * Public values that are valid private keys but belong to nobody.
 *
 * Two families: the standard proxy storage slots, and the shared development
 * accounts above. Both are excluded before any chain lookup, because both are
 * public and therefore have real on-chain history — the EIP-1967 implementation
 * slot derives to an address with a non-zero nonce on Moksha, and Hardhat
 * account #0 has been used on Vana and Moksha alike. The proxy slot appears in
 * every proxy deployment file we publish, so without this list one constant
 * produces hundreds of findings.
 *
 * Everything here is derived from its definition rather than pasted as a
 * literal, so a transcription slip cannot silently open a blind spot.
 */
export const PUBLISHED_CONSTANTS: ReadonlySet<string> = new Set([
  slotMinusOne("eip1967.proxy.implementation"),
  slotMinusOne("eip1967.proxy.admin"),
  slotMinusOne("eip1967.proxy.beacon"),
  slotMinusOne("eip1967.proxy.rollback"),
  id("PROXIABLE"), // ERC-1822 UUPS proxiable UUID
  id(""), // keccak256 of empty bytes
  keccak256("0x80"), // empty Merkle-Patricia trie root
  ...developmentKeys(),
]);

/**
 * A value appearing in at least this many distinct files is a shared constant,
 * not a leaked key. Real key leaks are one-off accidents; constants get copied.
 */
const SHARED_CONSTANT_FILE_THRESHOLD = 3;

/**
 * Smallest value we will treat as a real key.
 *
 * A key is 32 uniformly random bytes, so the probability that its top 16 bytes
 * are all zero is 2^-128 — it will not happen. Anything below this bound is an
 * ABI-encoded small integer: `bytes32(1)`, a length prefix, an array offset, an
 * enum. Those are pervasive in deployment artifacts, and because they are
 * public they derive to the well-known "private key = N" accounts, which have
 * been used on every chain. Excluding them is a statement about entropy, not a
 * denylist that has to be maintained.
 */
const MIN_PLAUSIBLE_KEY = 1n << 128n;

/**
 * A 64-hex run, with an optional `0x`. The lookarounds require that no hex
 * character sits immediately either side, so longer hex blobs are not chopped
 * into 64-char windows: a 128-hex uncompressed public key and a 192-hex BLS
 * signature both yield no candidate, which is correct — neither is a key.
 */
const HEX64 = /(?<![0-9a-fA-FxX])(?:0[xX])?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g;

/** Names that suggest the surrounding text is about a secret, not a digest. */
const SECRET_CONTEXT =
  /(private[_-]?key|privkey|secret[_-]?key|signing[_-]?key|deployer[_-]?key|signer[_-]?key|mnemonic|keystore|passphrase)/i;

/**
 * Paths that hold secrets often enough to be worth flagging unconditionally.
 * `/` is an allowed terminator so a *directory* named `secrets` counts too —
 * `config/secrets/prod.json` is exactly the case worth catching.
 */
const SECRET_PATH = /(^|\/)(\.env($|\.)|secrets?($|[._\-/])|keystore|\.secret)/i;

/** Directories with no hand-written content — build output, deps, coverage. */
const SKIP_DIRS = new Set([
  "node_modules",
  "artifacts",
  "cache",
  "coverage",
  "typechain-types",
  ".git",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface Candidate {
  /** Normalised `0x`-prefixed lowercase key. Never logged in full. */
  key: string;
  file: string;
  line: number;
}

/**
 * `critical`   — derives to an address in our own register. Unambiguously ours.
 * `verified`   — derives to an address with real on-chain history, and is not a
 *                published constant or a value shared across the tree.
 * `suspicious` — one weaker signal only: a secret-shaped filename or line, or
 *                chain history on a value that looks like a shared constant.
 */
export type Severity = "critical" | "verified" | "suspicious";

export interface Finding extends Candidate {
  address: string;
  severity: Severity;
  reasons: string[];
}

export interface ChainStatus {
  name: string;
  ok: boolean;
  error?: string;
}

/** Redact a key for display. Enough to locate it, not enough to use it. */
export function redact(key: string): string {
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/**
 * True if the value could plausibly be a real private key.
 *
 * Two bounds, both statements about entropy rather than about any particular
 * constant. Above, the curve order: values outside [1, N-1] are not keys, which
 * also disposes of `bytes32(0)` and all-`f` sentinels. Below, 2^128: a genuine
 * key is 32 random bytes and will never be that small, so anything under it is
 * an ABI-encoded integer rather than a secret.
 */
export function isPlausibleKey(hex64: string): boolean {
  const value = BigInt(`0x${hex64}`);
  return value >= MIN_PLAUSIBLE_KEY && value < SECP256K1_N;
}

/** Derive the address a private key would control. */
export function deriveAddress(key: string): string {
  return computeAddress(new SigningKey(key).publicKey);
}

/**
 * Pull every 64-hex candidate out of one line of text.
 *
 * `line` is the 1-based line number the text sits at in `file`.
 */
export function extractFromLine(
  text: string,
  file: string,
  line: number,
): Candidate[] {
  const found: Candidate[] = [];
  HEX64.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEX64.exec(text)) !== null) {
    const hex64 = match[1].toLowerCase();
    if (!isPlausibleKey(hex64)) continue;
    found.push({ key: `0x${hex64}`, file, line });
  }
  return found;
}

/** True if the candidate sits in text or a path that names a secret. */
export function looksLikeSecretContext(
  lineText: string,
  file: string,
): boolean {
  return SECRET_CONTEXT.test(lineText) || SECRET_PATH.test(file);
}

export interface ScanTarget {
  file: string;
  line: number;
  text: string;
}

/**
 * Added lines in a `git diff --unified=0` payload, as (file, line, text).
 *
 * Only `+` lines are considered: a candidate being *removed* is already in
 * history and is a rotation problem, not a "stop this push" problem.
 */
export function parseUnifiedDiff(raw: string): ScanTarget[] {
  const targets: ScanTarget[] = [];
  let file = "";
  let lineNo = 0;

  for (const raw_line of raw.split("\n")) {
    if (raw_line.startsWith("+++ ")) {
      const target = raw_line.slice(4).trim();
      file = target === "/dev/null" ? "" : target.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw_line);
    if (hunk) {
      lineNo = parseInt(hunk[1], 10);
      continue;
    }
    if (raw_line.startsWith("+") && !raw_line.startsWith("+++")) {
      if (file) targets.push({ file, line: lineNo, text: raw_line.slice(1) });
      lineNo++;
    }
  }
  return targets;
}

/** Added lines for a diff range, read from git. */
export function addedLinesFromDiff(range: string, cwd: string): ScanTarget[] {
  return parseUnifiedDiff(
    execFileSync(
      "git",
      ["diff", "--unified=0", "--no-color", "--diff-filter=ACMR", range],
      { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    ),
  );
}

/** Every line of every tracked text file. Used for a full-tree baseline. */
export function allTrackedLines(cwd: string): ScanTarget[] {
  const listed = execFileSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const targets: ScanTarget[] = [];
  for (const file of listed.split("\0")) {
    if (!file) continue;
    if (file.split("/").some((segment) => SKIP_DIRS.has(segment))) continue;

    const absolute = path.join(cwd, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      continue; // deleted from the working tree but still in the index
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) continue; // binary

    buffer
      .toString("utf8")
      .split("\n")
      .forEach((text, index) => {
        targets.push({ file, line: index + 1, text });
      });
  }
  return targets;
}

/** Load the optional register of known Vana addresses. */
export function loadRegistry(file: string | undefined): Set<string> {
  const registry = new Set<string>();
  if (!file) return registry;

  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const values = Array.isArray(parsed) ? parsed : Object.keys(parsed as object);
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      registry.add(getAddress(value).toLowerCase());
    } catch {
      // not an address — registers carry labels and metadata too
    }
  }
  return registry;
}

interface Chain {
  name: string;
  provider: JsonRpcProvider;
}

/**
 * A label safe to print. Provider URLs routinely carry an API key in the path
 * or query (QuickNode, Alchemy, Infura), and chain names end up in CI warnings,
 * so an unnamed endpoint is reduced to its hostname rather than echoed whole.
 */
export function safeDisplayName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unnamed-rpc";
  }
}

/** URLs embedded in prose — ethers puts the full request URL in error text. */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)\]},]+/gi;

/**
 * An error string safe to print.
 *
 * Sanitising the chain's display name is not enough on its own: ethers formats
 * failures with the whole `FetchRequest` URL, so a 401 or 429 from a private
 * endpoint carries the API key in `error.message` — and that message is stored
 * in `chainStatus`, printed as a CI warning and included in `--json` output.
 * Each URL is reduced to its hostname, which keeps the message diagnosable, and
 * the result is truncated so a provider's error payload cannot be dumped whole.
 */
export function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw.replace(URL_IN_TEXT, (url) => `[${safeDisplayName(url)}]`);
  return redacted.length > 200 ? `${redacted.slice(0, 200)}…` : redacted;
}

export function parseRpcUrls(raw: string | undefined): Chain[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const split = entry.indexOf("=");
      const hasName = split > 0 && !entry.slice(0, split).includes("://");
      const url = hasName ? entry.slice(split + 1).trim() : entry;
      const name = hasName ? entry.slice(0, split).trim() : safeDisplayName(url);
      return { name, provider: new JsonRpcProvider(url) };
    });
}

/**
 * Public RPC endpoints throttle aggressively — a full-tree run against
 * rpc.vana.org trips a 100/second limit. Keep the pool small and back off on
 * failure rather than reporting a rate-limited chain as clean.
 */
const RPC_CONCURRENCY = 4;
const RPC_ATTEMPTS = 4;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RPC_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      // 250ms, 500ms, 1s — enough to ride out a per-second quota. Do not wait
      // after the final attempt: there is nothing left to retry, and on a
      // hard-down endpoint that dead time is paid once per address.
      if (attempt < RPC_ATTEMPTS - 1) await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Run `worker` over `items` with bounded concurrency, preserving order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Which of these addresses has been used on chain.
 *
 * An address counts as used if it has ever sent a transaction (nonce > 0) or
 * holds a balance. Both are cheap, and either one is decisive: hashes do not
 * derive to funded accounts.
 *
 * A chain that errors is reported as errored rather than treated as "clean" —
 * silently downgrading every finding because an RPC was unreachable is the one
 * failure mode this check cannot afford.
 */
export async function findUsedAddresses(
  addresses: string[],
  chains: Chain[],
): Promise<{ used: Map<string, string[]>; status: ChainStatus[] }> {
  const used = new Map<string, string[]>();
  const status: ChainStatus[] = [];

  for (const chain of chains) {
    // Preflight, so a hard-down endpoint costs one probe instead of a retry
    // storm across every address. It retries too: without that, a single
    // transient blip would discard the whole chain and — under
    // --fail-on-verified — turn one dropped packet into a failed scan.
    try {
      await withRetry(() => chain.provider.getBlockNumber());
    } catch (error) {
      status.push({ name: chain.name, ok: false, error: sanitizeError(error) });
      continue;
    }

    let failed: string | undefined;
    await mapPool(addresses, RPC_CONCURRENCY, async (address) => {
      try {
        const [nonce, balance] = await withRetry(() =>
          Promise.all([
            chain.provider.getTransactionCount(address),
            chain.provider.getBalance(address),
          ]),
        );
        if (nonce > 0 || balance > 0n) {
          used.set(address, [...(used.get(address) ?? []), chain.name]);
        }
      } catch (error) {
        failed = sanitizeError(error);
      }
    });

    status.push({ name: chain.name, ok: !failed, error: failed });
  }

  return { used, status };
}

export interface ScanResult {
  candidates: number;
  distinctKeys: number;
  /** Distinct candidates dropped as published constants, before any lookup. */
  publishedConstants: number;
  findings: Finding[];
  chainStatus: ChainStatus[];
  livenessChecked: boolean;
}

export async function scan(
  targets: ScanTarget[],
  chains: Chain[],
  registry: Set<string>,
): Promise<ScanResult> {
  const candidates: Array<Candidate & { text: string }> = [];
  for (const target of targets) {
    for (const candidate of extractFromLine(target.text, target.file, target.line)) {
      candidates.push({ ...candidate, text: target.text });
    }
  }

  // One derivation and one set of RPC calls per distinct key, however many
  // times it appears.
  const byKey = new Map<string, Array<Candidate & { text: string }>>();
  for (const candidate of candidates) {
    byKey.set(candidate.key, [...(byKey.get(candidate.key) ?? []), candidate]);
  }

  // Drop published constants before deriving or querying anything: they are
  // nobody's key, and their addresses have on-chain history that would
  // otherwise read as a confirmed leak.
  let publishedConstants = 0;
  for (const key of [...byKey.keys()]) {
    if (PUBLISHED_CONSTANTS.has(key)) {
      byKey.delete(key);
      publishedConstants++;
    }
  }

  const derived = new Map<string, string>();
  for (const key of byKey.keys()) derived.set(key, deriveAddress(key));

  const addresses = [...new Set(derived.values())];
  const { used, status } =
    chains.length > 0
      ? await findUsedAddresses(addresses, chains)
      : { used: new Map<string, string[]>(), status: [] as ChainStatus[] };

  const findings: Finding[] = [];
  for (const [key, occurrences] of byKey) {
    const address = derived.get(key)!;
    const onChain = used.get(address);
    const registered = registry.has(address.toLowerCase());
    const secretContext = occurrences.some((occurrence) =>
      looksLikeSecretContext(occurrence.text, occurrence.file),
    );
    const distinctFiles = new Set(occurrences.map((o) => o.file)).size;
    const shared = distinctFiles >= SHARED_CONSTANT_FILE_THRESHOLD;

    // Only positive evidence opens a finding. Being shared across the tree is
    // never a reason to report — it only downgrades something already flagged.
    const reasons: string[] = [];
    if (onChain) reasons.push(`address has on-chain history (${onChain.join(", ")})`);
    if (registered) reasons.push("address is in the known-address register");
    if (secretContext) reasons.push("appears in a secret-shaped file or line");
    if (reasons.length === 0) continue;

    if (shared) {
      reasons.push(
        `downgraded: value appears in ${distinctFiles} files, which is characteristic of a shared constant rather than a leaked key`,
      );
    }

    let severity: Severity;
    if (registered) {
      severity = "critical";
    } else if (onChain && !shared) {
      severity = "verified";
    } else {
      severity = "suspicious";
    }

    // One finding per (key, file, line): a line can repeat the same value.
    const seen = new Set<string>();
    for (const occurrence of occurrences) {
      const at = `${occurrence.file}:${occurrence.line}`;
      if (seen.has(at)) continue;
      seen.add(at);
      findings.push({
        key,
        file: occurrence.file,
        line: occurrence.line,
        address,
        severity,
        reasons,
      });
    }
  }

  const rank: Record<Severity, number> = {
    critical: 0,
    verified: 1,
    suspicious: 2,
  };
  findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  return {
    candidates: candidates.length,
    distinctKeys: byKey.size,
    publishedConstants,
    findings,
    chainStatus: status,
    livenessChecked: chains.length > 0,
  };
}

/** Findings that mean "act now": ours, or provably used on chain. */
function confirmed(result: ScanResult): Finding[] {
  return result.findings.filter(
    (f) => f.severity === "critical" || f.severity === "verified",
  );
}

/**
 * True when the scan did not actually get to check what it claims to check.
 *
 * Liveness is the evidence this tool runs on. If an RPC was rate-limited, was
 * unreachable, or was never configured, a funded leaked key produces no finding
 * at all — indistinguishable from a clean run. A gate that passes in that state
 * is worse than no gate, so `--fail-on-verified` treats an incomplete scan as a
 * failure rather than as success.
 */
export function scanIncomplete(result: ScanResult): boolean {
  return !result.livenessChecked || result.chainStatus.some((c) => !c.ok);
}

function report(result: ScanResult, failOnVerified: boolean): number {
  const inCI = Boolean(process.env.GITHUB_ACTIONS);
  const critical = result.findings.filter((f) => f.severity === "critical");
  const verified = result.findings.filter((f) => f.severity === "verified");
  const suspicious = result.findings.filter((f) => f.severity === "suspicious");

  console.log(
    `keyscan: ${result.candidates} 64-hex candidate(s), ${result.distinctKeys} distinct ` +
      `(${result.publishedConstants} published constant(s) excluded), ` +
      `${critical.length} critical, ${verified.length} verified, ${suspicious.length} suspicious`,
  );

  for (const chain of result.chainStatus) {
    if (!chain.ok) {
      const message = `keyscan: liveness check against ${chain.name} failed (${chain.error}) — findings for that chain are incomplete`;
      console.log(inCI ? `::warning::${message}` : `  ! ${message}`);
    }
  }
  if (!result.livenessChecked) {
    const message =
      "keyscan: KEYSCAN_RPC_URLS is unset, so no liveness checks ran — only register and filename signals were applied";
    console.log(inCI ? `::warning::${message}` : `  ! ${message}`);
  }

  for (const finding of result.findings) {
    const label = finding.severity.toUpperCase();
    const detail =
      `${label}: ${redact(finding.key)} derives to ${finding.address} — ` +
      finding.reasons.join("; ");

    if (inCI) {
      const level = finding.severity === "suspicious" ? "warning" : "error";
      console.log(
        `::${level} file=${finding.file},line=${finding.line}::${detail}. ` +
          `This repository is public: treat the key as compromised and ROTATE it. ` +
          `Removing the line does not undo the exposure.`,
      );
    } else {
      console.log(`  ${finding.file}:${finding.line}  ${detail}`);
    }
  }

  if (confirmed(result).length > 0) {
    console.log(
      "\nkeyscan: a critical or verified hit means the derived address is ours or has really " +
        "been used on chain. This repository is public, so rotate the key and move any funds " +
        "first — deleting the line does not undo the exposure.",
    );
  }

  if (failOnVerified && scanIncomplete(result)) {
    console.log(
      "\nkeyscan: failing because the scan was incomplete — liveness could not be checked " +
        "against every chain, so a funded leaked key would look identical to a clean run.",
    );
    return 1;
  }

  return failOnVerified && confirmed(result).length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const cwd = process.cwd();
  const diff = arg("--diff");
  const all = argv.includes("--all");
  const asJson = argv.includes("--json");
  const failOnVerified = argv.includes("--fail-on-verified");

  if (!diff && !all) {
    console.error(
      "usage: scan.ts (--diff <range> | --all) [--json] [--fail-on-verified]",
    );
    process.exit(2);
  }

  const targets = diff ? addedLinesFromDiff(diff, cwd) : allTrackedLines(cwd);
  const chains = parseRpcUrls(process.env.KEYSCAN_RPC_URLS);
  const registry = loadRegistry(process.env.KEYSCAN_ADDRESS_REGISTRY);

  const result = await scan(targets, chains, registry);

  if (asJson) {
    // Keys are redacted here too: this output lands in CI artifacts.
    console.log(
      JSON.stringify(
        {
          ...result,
          findings: result.findings.map((f) => ({ ...f, key: redact(f.key) })),
        },
        null,
        2,
      ),
    );
    process.exit(
      failOnVerified && (confirmed(result).length > 0 || scanIncomplete(result))
        ? 1
        : 0,
    );
  }

  process.exit(report(result, failOnVerified));
}

if (require.main === module) {
  main().catch((error) => {
    // Sanitised like every other error path: a startup failure (a malformed
    // KEYSCAN_RPC_URLS entry, a provider constructor throw) can carry the URL,
    // and printing the raw error here would undo the redaction everywhere else.
    console.error("keyscan failed:", sanitizeError(error));
    process.exit(2);
  });
}
