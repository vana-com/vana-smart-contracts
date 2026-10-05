import { ethers, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Cross-check every proxy on Vana mainnet:
 *
 *   A. liveImplPointer        — proxy's ERC1967 IMPLEMENTATION_SLOT
 *   B. latestDeployedImpl     — address recorded in *Implementation.json artifact
 *   C. artifactBytecode       — deployedBytecode in *Implementation.json
 *   D. currentSourceBytecode  — deployedBytecode from compiling current source
 *
 * Drift states:
 *   AT_LATEST_NEEDS_REDEPLOY  — A == B, but C != D (source moved ahead; needs new impl + upgrade)
 *   IMPL_DRIFT                — A != B  (new impl exists, proxy not upgraded yet)
 *   AT_LATEST                 — A == B AND C == D (everything in sync)
 *   BYTECODE_DRIFT_LIVE       — A == B but live runtime bytecode differs from artifact bytecode
 *                               (artifact is stale relative to what's actually onchain)
 */

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const DEPLOY_DIRS = [
  path.resolve(__dirname, "../deployments/vana"),
  path.resolve(__dirname, "../deployments-official/vana"),
];

interface ArtifactJson {
  address?: string;
  deployedBytecode?: string;
  contractName?: string;
}

function readJson(p: string): ArtifactJson | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function findArtifact(name: string): { artifact: ArtifactJson; source: string } | null {
  for (const dir of DEPLOY_DIRS) {
    const p = path.join(dir, `${name}.json`);
    if (fs.existsSync(p)) {
      const a = readJson(p);
      if (a) return { artifact: a, source: path.basename(dir) };
    }
  }
  return null;
}

function stripMetadata(bc: string): string {
  // Solc appends a CBOR-encoded metadata block at the end of deployed bytecode.
  // The last 2 bytes encode the length (big-endian) of the metadata in bytes.
  // Total trailer = metadataLen + 2 (the length suffix).
  if (!bc.startsWith("0x")) bc = "0x" + bc;
  if (bc.length <= 6) return bc.toLowerCase();
  const lengthHex = bc.slice(-4);
  const metadataLen = parseInt(lengthHex, 16);
  if (Number.isNaN(metadataLen) || metadataLen <= 0 || metadataLen > 2048) {
    return bc.toLowerCase();
  }
  const totalTrailerHexChars = (metadataLen + 2) * 2;
  if (bc.length - 2 <= totalTrailerHexChars) return bc.toLowerCase();
  return bc.slice(0, bc.length - totalTrailerHexChars).toLowerCase();
}

function enumerateProxies(): { base: string; proxyAddress: string }[] {
  const out: { base: string; proxyAddress: string }[] = [];
  const seen = new Set<string>();
  for (const dir of DEPLOY_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith("Proxy.json")) continue;
      const base = f.replace(/Proxy\.json$/, "");
      if (seen.has(base)) continue;
      seen.add(base);
      // Skip Test proxies
      if (/Test$/.test(base)) continue;
      const a = readJson(path.join(dir, f));
      if (a?.address) out.push({ base, proxyAddress: a.address });
    }
  }
  return out.sort((a, b) => a.base.localeCompare(b.base));
}

async function tryCompileSourceBytecode(contractName: string): Promise<string | null> {
  // Try the impl name variants in order
  const candidates = [contractName + "Implementation", contractName];
  for (const c of candidates) {
    try {
      const art = await artifacts.readArtifact(c);
      if (art.deployedBytecode && art.deployedBytecode !== "0x") return art.deployedBytecode;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 1480) {
    console.error("Run with --network vana (chainId 1480). Got:", network.chainId);
    process.exit(1);
  }

  const proxies = enumerateProxies();
  console.log(`Proxies enumerated: ${proxies.length}`);
  console.log();

  type Row = {
    name: string;
    proxy: string;
    liveImpl: string;
    latestImpl: string | null;
    pointerMatch: boolean;
    artifactBytecodeMatchesLive: boolean | null;
    sourceMatchesArtifact: boolean | null;
    state: string;
  };
  const rows: Row[] = [];

  for (const { base, proxyAddress } of proxies) {
    // Live impl pointer
    let liveImpl: string;
    try {
      const raw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
      liveImpl = ethers.getAddress("0x" + raw.slice(-40));
    } catch {
      continue;
    }
    if (liveImpl === ethers.ZeroAddress) continue; // not ERC1967

    // Latest deployed impl per artifact
    const implArt = findArtifact(base + "Implementation");
    const latestImpl = implArt?.artifact.address ?? null;
    const pointerMatch =
      latestImpl !== null && liveImpl.toLowerCase() === latestImpl.toLowerCase();

    // Bytecode: artifact vs live impl
    let artifactBytecodeMatchesLive: boolean | null = null;
    try {
      const liveBytecode = await ethers.provider.getCode(liveImpl);
      if (implArt?.artifact.deployedBytecode) {
        artifactBytecodeMatchesLive =
          stripMetadata(liveBytecode) === stripMetadata(implArt.artifact.deployedBytecode);
      }
    } catch {}

    // Bytecode: source vs artifact (does current compile match what's tracked?)
    let sourceMatchesArtifact: boolean | null = null;
    const sourceBytecode = await tryCompileSourceBytecode(base);
    if (sourceBytecode && implArt?.artifact.deployedBytecode) {
      sourceMatchesArtifact =
        stripMetadata(sourceBytecode) === stripMetadata(implArt.artifact.deployedBytecode);
    }

    let state: string;
    if (!pointerMatch) state = "IMPL_DRIFT";
    else if (artifactBytecodeMatchesLive === false) state = "BYTECODE_DRIFT_LIVE";
    else if (sourceMatchesArtifact === false) state = "AT_LATEST_NEEDS_REDEPLOY";
    else if (sourceMatchesArtifact === null) state = "AT_LATEST_NO_SOURCE";
    else state = "AT_LATEST";

    rows.push({
      name: base,
      proxy: proxyAddress,
      liveImpl,
      latestImpl,
      pointerMatch,
      artifactBytecodeMatchesLive,
      sourceMatchesArtifact,
      state,
    });
  }

  const byState: Record<string, Row[]> = {};
  for (const r of rows) (byState[r.state] ??= []).push(r);

  const print = (title: string, list?: Row[]) => {
    console.log("===== " + title + " (" + (list?.length ?? 0) + ") =====");
    if (!list || list.length === 0) return;
    for (const r of list) {
      console.log(`  ${r.name}`);
      console.log(`    proxy:        ${r.proxy}`);
      console.log(`    live impl:    ${r.liveImpl}`);
      if (r.latestImpl) console.log(`    latest impl:  ${r.latestImpl}`);
    }
    console.log();
  };

  print("IMPL_DRIFT — proxy needs upgradeToAndCall", byState.IMPL_DRIFT);
  print("AT_LATEST_NEEDS_REDEPLOY — source ahead of mainnet, redeploy + upgrade", byState.AT_LATEST_NEEDS_REDEPLOY);
  print("BYTECODE_DRIFT_LIVE — artifact bytecode does not match what's actually onchain", byState.BYTECODE_DRIFT_LIVE);
  print("AT_LATEST — proxy + source in sync", byState.AT_LATEST);
  print("AT_LATEST_NO_SOURCE — could not compile from current source (legacy / removed)", byState.AT_LATEST_NO_SOURCE);

  console.log("Summary:");
  for (const s of [
    "IMPL_DRIFT",
    "AT_LATEST_NEEDS_REDEPLOY",
    "BYTECODE_DRIFT_LIVE",
    "AT_LATEST",
    "AT_LATEST_NO_SOURCE",
  ]) {
    console.log(`  ${s.padEnd(26)} ${byState[s]?.length ?? 0}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
