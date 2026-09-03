import { ethers, artifacts } from "hardhat";

/**
 * Compare current DataRegistryV2Implementation source against the live impl
 * deployed on Moksha (the proxy at 0x8f1e…1867). The live impl is whatever
 * the ERC1967 IMPLEMENTATION_SLOT currently points at.
 *
 * Strategy:
 *   1. Read live impl bytecode from Moksha.
 *   2. Compile from current source -> deployedBytecode.
 *   3. Strip the variable-length CBOR metadata trailer from both
 *      (last 2 bytes encode metadata length).
 *   4. Hash + compare. If they match: source == deployed. If they differ,
 *      slide a window through both to find the first hex divergence so we
 *      can tell whether the diff is metadata-only or substantive.
 */

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const REGISTRY_PROXY = "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867";

function stripMetadata(bc: string): { stripped: string; metaLen: number } {
  if (!bc.startsWith("0x")) bc = "0x" + bc;
  if (bc.length <= 6) return { stripped: bc.toLowerCase(), metaLen: 0 };
  const metaLen = parseInt(bc.slice(-4), 16);
  if (Number.isNaN(metaLen) || metaLen <= 0 || metaLen > 2048) {
    return { stripped: bc.toLowerCase(), metaLen: 0 };
  }
  const trailerHex = (metaLen + 2) * 2;
  if (bc.length - 2 <= trailerHex) return { stripped: bc.toLowerCase(), metaLen };
  return { stripped: bc.slice(0, bc.length - trailerHex).toLowerCase(), metaLen };
}

function firstDivergence(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 14800) {
    console.error("Run with --network moksha (chainId 14800). Got:", chainId);
    process.exit(1);
  }

  // 1. Live impl pointer
  const raw = await ethers.provider.getStorage(REGISTRY_PROXY, IMPL_SLOT);
  const liveImpl = ethers.getAddress("0x" + raw.slice(-40));
  console.log("Proxy:        ", REGISTRY_PROXY);
  console.log("Live impl:    ", liveImpl);

  // 2. Onchain bytecode
  const liveBc = await ethers.provider.getCode(liveImpl);

  // 3. Source compile
  const art = await artifacts.readArtifact("DataRegistryV2Implementation");
  const sourceBc = art.deployedBytecode;

  console.log("\nBytecode lengths (hex chars):");
  console.log("  live:    ", liveBc.length);
  console.log("  source:  ", sourceBc.length);

  const live = stripMetadata(liveBc);
  const source = stripMetadata(sourceBc);

  console.log("\nMetadata trailer lengths (bytes):");
  console.log("  live:    ", live.metaLen);
  console.log("  source:  ", source.metaLen);

  console.log("\nStripped bytecode lengths (hex chars):");
  console.log("  live:    ", live.stripped.length);
  console.log("  source:  ", source.stripped.length);

  console.log("\nHashes:");
  console.log("  live   (raw     keccak):", ethers.keccak256(liveBc));
  console.log("  source (raw     keccak):", ethers.keccak256(sourceBc));
  console.log("  live   (stripped keccak):", ethers.keccak256(live.stripped));
  console.log("  source (stripped keccak):", ethers.keccak256(source.stripped));

  if (live.stripped === source.stripped) {
    console.log("\n✓ MATCH — current source compiles to byte-for-byte the deployed runtime (modulo metadata).");
    return;
  }

  // The UUPS __self immutable bakes `address(this)` (= the impl address) into
  // the runtime bytecode at every reference site. Source bytecode has zeros
  // where the immutable would go. To compare logical source, replace every
  // occurrence of the impl address in live with zeros, then diff.
  const a = live.stripped;
  const b = source.stripped;
  const implHex = liveImpl.slice(2).toLowerCase(); // 40 chars
  const zeros = "0".repeat(40);

  // Count occurrences of impl address in live bytecode.
  const occurrences = (a.match(new RegExp(implHex, "g")) ?? []).length;
  console.log(`\nImpl address (${implHex}) occurrences in live bytecode: ${occurrences}`);
  console.log("(These are UUPS __self immutable references baked in by the constructor.)");

  // Substitute and recompare.
  const aNormalized = a.replaceAll(implHex, zeros);
  const matches = aNormalized === b;
  console.log("\nAfter substituting impl address with zeros in live bytecode:");
  console.log("  normalized live keccak:", ethers.keccak256(aNormalized));
  console.log("  source     keccak:    ", ethers.keccak256(b));
  console.log("  match:                ", matches ? "✓ YES" : "✗ NO");

  if (matches) {
    console.log("\n✓ SOURCE MATCHES DEPLOYED — every byte of divergence is the UUPS __self immutable.");
    console.log("  Conclusion: nothing was removed or altered in DataRegistryV2Implementation.sol.");
    console.log("  The Moksha-deployed contract IS what the current source compiles to.");
    return;
  }

  // If still not matching, find remaining divergences for inspection.
  console.log("\n✗ Residual divergence after immutable substitution. Investigating…");
  for (let i = 0; i < Math.min(aNormalized.length, b.length); i++) {
    if (aNormalized[i] !== b[i]) {
      console.log(`  First differing hex char at offset ${i}`);
      console.log(`  live (normalized): ${aNormalized.slice(Math.max(0, i - 16), i + 64)}`);
      console.log(`  source:            ${b.slice(Math.max(0, i - 16), i + 64)}`);
      break;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
