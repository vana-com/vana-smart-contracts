import { ethers } from "hardhat";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// expectedImpl = Hashlock 6th audit fix set (commit b8ed895), CREATE2 addresses from
// scripts/dataPortabilityV2/hashlock6UpgradeBatch.ts; see docs/dataPortability/MAINNET_UPGRADE_RUNBOOK_HASHLOCK6.md
const CONTRACTS: { name: string; proxy: string; expectedImpl: string }[] = [
  {
    name: "Escrow",
    proxy: "0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3",
    expectedImpl: "0xb54EB5bC78E36EbB2D55917B8aBBD8D5D5aE304F",
  },
  {
    name: "PermissionsV2",
    proxy: "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011",
    expectedImpl: "0x2DA18814FbAAbAd6409A278ce63a8BEaB744d14d",
  },
  {
    name: "DataRegistryV2",
    proxy: "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867",
    expectedImpl: "0x8dB6Cf7242Eb3C2554f3e7647f0e5160e4B4D45B",
  },
  {
    name: "ServersV2",
    proxy: "0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab",
    expectedImpl: "0xb2E34Dd13bD1B525fd840a7759Ea2FDF38A6e13A",
  },
  {
    name: "FeeRegistry",
    proxy: "0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2",
    expectedImpl: "0x3A95fC4B4FE7Ca6e83dE71B4D9Afe6D2D92Afef8",
  },
];

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log("chainId:", chainId);
  console.log();

  for (const c of CONTRACTS) {
    const raw = await ethers.provider.getStorage(c.proxy, IMPL_SLOT);
    const live = ethers.getAddress("0x" + raw.slice(-40));
    const matches = live.toLowerCase() === c.expectedImpl.toLowerCase();
    console.log(c.name.padEnd(16), "live:", live, matches ? "  ✓ at latest" : "  ⚠ NEEDS UPGRADE");
    if (!matches) console.log(" ".repeat(16), "want:", c.expectedImpl);
  }

  // Also check PermissionsV2.dataPortabilityServers wiring (matters even after the impl is live)
  console.log();
  const perms = await ethers.getContractAt(
    "DataPortabilityPermissionsV2Implementation",
    "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011",
  );
  try {
    const wired = await perms.dataPortabilityServers();
    console.log("PermissionsV2.dataPortabilityServers():", wired);
  } catch (e) {
    console.log("PermissionsV2.dataPortabilityServers(): function not callable (proxy still on old impl)");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
