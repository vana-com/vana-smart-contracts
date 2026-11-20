/**
 * Shared facts for the data-portability V2 upgrade that ships the Hashlock 6th
 * audit fixes (fix-review commit b8ed895). Used by the Ledger deploy script, the
 * Safe batch builder and the fork simulation so the three can never disagree.
 *
 * Implementations are CREATE2 deployments through the shared factory with fixed
 * salts: their addresses follow from this commit's bytecode alone, so the Safe
 * batch can be built, reviewed and signed before the Ledger has deployed them.
 */
import { artifacts, ethers } from "hardhat";

export const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const SALT_SUFFIX = "-hashlock6";

const env = (k: string, d: string) => process.env[k] || d;
export const SAFE = ethers.getAddress(env("SAFE_ADDRESS", "0x5eca5208f29e32879a711467916965b2d753baf4"));
export const FEE_REGISTRY = ethers.getAddress(env("FEE_REGISTRY_PROXY_ADDRESS", "0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2"));

/** Upgrade order. Each entry is one upgradeToAndCall in the Safe batch. */
export const UPGRADES = [
  {
    key: "dataRegistryV2",
    contract: "DataRegistryV2Implementation",
    proxy: ethers.getAddress(env("DATA_REGISTRY_V2_PROXY_ADDRESS", "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867")),
    liveVersion: 1n,
    targetVersion: 1n, // Q-02/Q-03/Q-04: events + validation only, no storage change
    why: "Q-02 direct setStatus cancels pending status signatures; Q-03 StatusSequenceConsumed event; Q-04 dead-code removal",
  },
  {
    key: "serversV2",
    contract: "DataPortabilityServersV2Implementation",
    proxy: ethers.getAddress(env("DATA_PORTABILITY_SERVERS_V2_PROXY_ADDRESS", "0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab")),
    liveVersion: 1n,
    targetVersion: 2n,
    why: "M-01/Q-06 ERC-2771 removed; Q-01 registerServerWithProof + requireServerProof flag (stays OFF); Q-04",
  },
  {
    key: "permissionsV2",
    contract: "DataPortabilityPermissionsV2Implementation",
    proxy: ethers.getAddress(env("DATA_PORTABILITY_PERMISSIONS_V2_PROXY_ADDRESS", "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011")),
    liveVersion: 1n,
    targetVersion: 1n,
    why: "L-01 capped grantVersion step (2^64); Q-05 scope limits (64 scopes, 128 bytes, no duplicates); Q-04",
  },
  {
    key: "escrow",
    contract: "DataPortabilityEscrowImplementation",
    proxy: ethers.getAddress(env("DATA_PORTABILITY_ESCROW_PROXY_ADDRESS", "0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3")),
    liveVersion: 1n,
    targetVersion: 2n,
    why: "payee pinning: every settle path pays only the FeeRegistry payee for the OpKind; needs setFeeRegistry in the same call",
  },
] as const;

export type Upgrade = (typeof UPGRADES)[number];

export const saltFor = (contract: string) => `${contract}${SALT_SUFFIX}`;
export const saltHashFor = (contract: string) => ethers.keccak256(ethers.toUtf8Bytes(saltFor(contract)));

/** CREATE2 address of `contract` through the shared factory, from this commit's artifact. */
export async function predictImplementation(contract: string): Promise<string> {
  const { bytecode } = await artifacts.readArtifact(contract);
  return ethers.getCreate2Address(FACTORY, saltHashFor(contract), ethers.keccak256(bytecode));
}

const upgradeIface = new ethers.Interface([
  "function upgradeToAndCall(address newImplementation, bytes data)",
  "function setFeeRegistry(address newFeeRegistry)",
]);

/** Calldata the Safe sends to `u.proxy`. Only the escrow carries an init payload. */
export function upgradeCalldata(u: Upgrade, implementation: string): { data: string; note: string } {
  if (u.key === "escrow") {
    const inner = upgradeIface.encodeFunctionData("setFeeRegistry", [FEE_REGISTRY]);
    return {
      data: upgradeIface.encodeFunctionData("upgradeToAndCall", [implementation, inner]),
      note: `${u.contract}: upgradeToAndCall(${implementation}, setFeeRegistry(${FEE_REGISTRY})) — atomic, or every settle reverts FeeRegistryNotSet`,
    };
  }
  return {
    data: upgradeIface.encodeFunctionData("upgradeToAndCall", [implementation, "0x"]),
    note: `${u.contract}: upgradeToAndCall(${implementation}, 0x)`,
  };
}

export const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export async function liveImplementation(proxy: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxy, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(-40));
}
