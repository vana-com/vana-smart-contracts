import { ethers } from "hardhat";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const CONTRACTS: { name: string; proxy: string; expectedImpl: string }[] = [
  {
    name: "Escrow",
    proxy: "0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3",
    expectedImpl: "0x3d675c462B5DB6Ab2850901f008fE0b949eA7B5A",
  },
  {
    name: "PermissionsV2",
    proxy: "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011",
    expectedImpl: "0x4E71094c8cd2065F1C0C85e978d7f53B79B1AA84",
  },
  {
    name: "DataRegistryV2",
    proxy: "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867",
    expectedImpl: "0xFa48B6E19B177C1c0A8E19Af7A2e0e8E64640C54",
  },
  {
    name: "ServersV2",
    proxy: "0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab",
    expectedImpl: "0x97537454751eE1A649C92Ac1BA7D0E4a9E90D1fd",
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
