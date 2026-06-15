import { ethers, artifacts } from "hardhat";

/**
 * Detailed up-to-date check for ServersV2, FeeRegistry, DataPortabilityGrantees on Vana mainnet.
 *
 * For each, compare:
 *   - Live impl bytecode (onchain, at the proxy's IMPLEMENTATION_SLOT)
 *   - "Latest tracked" impl bytecode (onchain, at the address stored in *Implementation.json)
 *   - Current source compile (artifacts/.../*.sol/Implementation.json deployedBytecode)
 *
 * Metadata is stripped before comparison using the variable-length CBOR trailer
 * convention (last 2 bytes encode metadata length).
 */

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const TARGETS = [
  {
    name: "DataPortabilityServersV2",
    proxy: "0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab",
    implContract: "DataPortabilityServersV2Implementation",
  },
  {
    name: "FeeRegistry",
    proxy: "0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2",
    implContract: "FeeRegistryImplementation",
  },
  {
    name: "DataPortabilityGrantees",
    proxy: "0x8325C0A0948483EdA023A1A2Fd895e62C5131234",
    implContract: "DataPortabilityGranteesImplementation",
  },
];

const TRACKED_IMPL: Record<string, string> = {
  DataPortabilityServersV2: "0x97537454751eE1A649C92Ac1BA7D0E4a9E90D1fd",
  FeeRegistry: "0x3A95fC4B4FE7Ca6e83dE71B4D9Afe6D2D92Afef8",
  DataPortabilityGrantees: "0x69A1bEeee1aA8d7A4b853FF1001DF510e867b577",
};

function stripMetadata(bc: string): string {
  if (!bc) return "";
  if (!bc.startsWith("0x")) bc = "0x" + bc;
  if (bc.length <= 6) return bc.toLowerCase();
  const metadataLen = parseInt(bc.slice(-4), 16);
  if (Number.isNaN(metadataLen) || metadataLen <= 0 || metadataLen > 2048) return bc.toLowerCase();
  const totalTrailerHexChars = (metadataLen + 2) * 2;
  if (bc.length - 2 <= totalTrailerHexChars) return bc.toLowerCase();
  return bc.slice(0, bc.length - totalTrailerHexChars).toLowerCase();
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 1480) {
    console.error("Run with --network vana");
    process.exit(1);
  }

  for (const t of TARGETS) {
    console.log("=".repeat(70));
    console.log(t.name);
    console.log("=".repeat(70));
    console.log(`proxy:           ${t.proxy}`);

    const raw = await ethers.provider.getStorage(t.proxy, IMPL_SLOT);
    const liveImpl = ethers.getAddress("0x" + raw.slice(-40));
    const trackedImpl = TRACKED_IMPL[t.name];

    console.log(`live impl:       ${liveImpl}`);
    console.log(`tracked impl:    ${trackedImpl}`);
    console.log(`pointer match:   ${liveImpl.toLowerCase() === trackedImpl.toLowerCase() ? "✓ YES" : "✗ NO — needs upgrade"}`);

    const liveBc = await ethers.provider.getCode(liveImpl);
    const trackedBc = liveImpl.toLowerCase() === trackedImpl.toLowerCase()
      ? liveBc
      : await ethers.provider.getCode(trackedImpl);

    let sourceBc: string | null = null;
    try {
      const a = await artifacts.readArtifact(t.implContract);
      sourceBc = a.deployedBytecode;
    } catch (e) {
      console.log(`current source:  could not compile ${t.implContract}: ${(e as Error).message}`);
    }

    const liveStripped = stripMetadata(liveBc);
    const trackedStripped = stripMetadata(trackedBc);
    const sourceStripped = sourceBc ? stripMetadata(sourceBc) : null;

    console.log(`live bytecode (stripped) hash:    ${ethers.id(liveStripped).slice(0, 18)}…`);
    console.log(`tracked bytecode (stripped) hash: ${ethers.id(trackedStripped).slice(0, 18)}…`);
    if (sourceStripped) {
      console.log(`source bytecode (stripped) hash:  ${ethers.id(sourceStripped).slice(0, 18)}…`);
    }

    console.log();
    console.log("Verdict:");
    if (liveStripped === trackedStripped && sourceStripped && liveStripped === sourceStripped) {
      console.log("  ✓ UP TO DATE — live impl matches tracked impl AND current source.");
    } else if (liveStripped !== trackedStripped) {
      console.log(`  ✗ PROXY POINTS AT OLDER IMPL — newer impl ${trackedImpl} is deployed`);
      if (sourceStripped && trackedStripped === sourceStripped) {
        console.log("  ↳ tracked impl matches current source — upgrade activates the latest code");
      } else if (sourceStripped && trackedStripped !== sourceStripped) {
        console.log("  ↳ tracked impl ALSO differs from current source — source is ahead of both");
      }
    } else if (sourceStripped && liveStripped !== sourceStripped) {
      console.log("  ⚠ live impl matches tracked impl but DIFFERS from current source");
      console.log("  ↳ source has been modified since last deploy — redeploy + upgrade needed");
    } else {
      console.log("  ? Cannot conclude — source bytecode unavailable");
    }
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
