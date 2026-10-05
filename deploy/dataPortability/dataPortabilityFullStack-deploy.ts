import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, verifyProxy } from "../helpers";

/**
 * Cross-chain matching deploy for the full data-portability stack.
 *
 * Strategy: bootstrap-then-transfer.
 *   1. Every proxy is initialize'd with the DEPLOYER address as bootstrap
 *      admin. Since DEPLOYER_PRIVATE_KEY yields the same address on every
 *      chain, init data is byte-identical → CREATE2 proxy addresses match.
 *   2. Cross-contract pointers + role grants happen while the deployer
 *      still has DEFAULT_ADMIN_ROLE.
 *   3. Last step: hand DEFAULT_ADMIN_ROLE (and MAINTAINER_ROLE on ServersV2)
 *      to the chain-specific owner, then renounce from deployer.
 *      Skipped entirely on chains where deployer == owner (e.g. Moksha
 *      using 0x2AC9…).
 *
 * Contracts:
 *   - FeeRegistry
 *   - DataPortabilityServersV2
 *   - DataPortabilityPermissionsV2
 *   - DataRegistryV2
 *   - DataPortabilityEscrow
 *
 * Wiring:
 *   - DataRegistryV2.setDataPortabilityServers → ServersV2 proxy
 *   - Escrow.setPermissions → PermissionsV2 proxy
 *   - Escrow.setDataRegistry → DataRegistryV2 proxy
 *
 * Roles:
 *   - DataRegistryV2.grantRole(ACCESS_RECORDER_ROLE, Escrow proxy)
 *   - Escrow.grantRole(FACILITATOR_ROLE, FACILITATOR) + revoke from deployer
 */

const FACILITATOR = "0x80534af0b80ae88d653Cae0a8f5d2667439538a0";

/// Bump this to land at a fresh CREATE2 address set (e.g., when admin policy
/// changes and the prior deployment can't be reused). All proxies use
/// `proxyContractName + SALT_SUFFIX` as the salt — change in lockstep so
/// every contract lands at a new address.
const SALT_SUFFIX = "/Canonical";

/// Per-chain admin handoff target. On Moksha we deliberately leave the
/// admin as the deployer (chain owner === deployer.address); the script
/// detects equality and skips the admin transfer. On mainnet we hand off
/// to the designated multisig / EOA below.
const CHAIN_OWNERS: Record<number, string | "DEPLOYER"> = {
  14800: "DEPLOYER", // Moksha — deployer is the admin (no transfer)
  1480: "0x5ECA5208F29e32879a711467916965B2D753bAf4", // Vana mainnet
};

const DEFAULT_ADMIN_ROLE = "0x" + "00".repeat(32);
const MAINTAINER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MAINTAINER_ROLE"));
const ACCESS_RECORDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ACCESS_RECORDER_ROLE"));
const FACILITATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACILITATOR_ROLE"));

interface DeployResult {
  proxyAddress: string;
  implementationAddress: string;
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(hre.network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);
  const ownerSpec = CHAIN_OWNERS[chainId];
  if (!ownerSpec) throw new Error(`No CHAIN_OWNER configured for chainId=${chainId}`);
  const chainOwner = ownerSpec === "DEPLOYER" ? deployer.address : ownerSpec;

  console.log("=================================================");
  console.log("Chain:                 ", hre.network.name, `(chainId=${chainId})`);
  console.log("Deployer (bootstrap):  ", deployer.address);
  console.log("Final chain owner:     ", chainOwner);
  console.log("Facilitator (FACILITATOR_ROLE):", FACILITATOR);
  console.log("=================================================");

  // ============================================================
  // 1. Deploy proxies (init data is byte-identical across chains)
  // ============================================================

  const feeReg = await deployOne(
    deployer,
    "FeeRegistryProxy",
    "FeeRegistryImplementation",
    [deployer.address],
    "contracts/protocol/feeRegistry/FeeRegistryProxy.sol:FeeRegistryProxy",
  );

  const serversV2 = await deployOne(
    deployer,
    "DataPortabilityServersV2Proxy",
    "DataPortabilityServersV2Implementation",
    [ethers.ZeroAddress, deployer.address],
    "contracts/dataPortability/dataPortabilityServersV2/DataPortabilityServersV2Proxy.sol:DataPortabilityServersV2Proxy",
  );

  const permissionsV2 = await deployOne(
    deployer,
    "DataPortabilityPermissionsV2Proxy",
    "DataPortabilityPermissionsV2Implementation",
    [deployer.address],
    "contracts/dataPortability/dataPortabilityPermissionsV2/DataPortabilityPermissionsV2Proxy.sol:DataPortabilityPermissionsV2Proxy",
  );

  const dataRegistryV2 = await deployOne(
    deployer,
    "DataRegistryV2Proxy",
    "DataRegistryV2Implementation",
    [deployer.address],
    "contracts/data/dataRegistryV2/DataRegistryV2Proxy.sol:DataRegistryV2Proxy",
  );

  const escrow = await deployOne(
    deployer,
    "DataPortabilityEscrowProxy",
    "DataPortabilityEscrowImplementation",
    [deployer.address, deployer.address],
    "contracts/dataPortability/dataPortabilityEscrow/DataPortabilityEscrowProxy.sol:DataPortabilityEscrowProxy",
  );

  // ============================================================
  // 2. Wire cross-contract pointers
  // ============================================================
  console.log("\n=== Wiring cross-contract pointers ===");

  const dataRegistry = await ethers.getContractAt(
    "DataRegistryV2Implementation",
    dataRegistryV2.proxyAddress,
  );
  await ensureWired(
    "dataRegistry.dataPortabilityServers",
    async () => await dataRegistry.dataPortabilityServers(),
    async () => await dataRegistry.connect(deployer).setDataPortabilityServers(serversV2.proxyAddress),
    serversV2.proxyAddress,
  );

  const escrowContract = await ethers.getContractAt(
    "DataPortabilityEscrowImplementation",
    escrow.proxyAddress,
  );
  await ensureWired(
    "escrow.permissions",
    async () => await escrowContract.permissions(),
    async () => await escrowContract.connect(deployer).setPermissions(permissionsV2.proxyAddress),
    permissionsV2.proxyAddress,
  );
  await ensureWired(
    "escrow.dataRegistry",
    async () => await escrowContract.dataRegistry(),
    async () => await escrowContract.connect(deployer).setDataRegistry(dataRegistryV2.proxyAddress),
    dataRegistryV2.proxyAddress,
  );

  // ============================================================
  // 3. Grant operational roles
  // ============================================================
  console.log("\n=== Granting operational roles ===");

  await ensureGranted(
    "dataRegistry.ACCESS_RECORDER_ROLE → escrow proxy",
    dataRegistry,
    ACCESS_RECORDER_ROLE,
    escrow.proxyAddress,
    deployer,
  );

  await ensureGranted(
    "escrow.FACILITATOR_ROLE → " + FACILITATOR,
    escrowContract,
    FACILITATOR_ROLE,
    FACILITATOR,
    deployer,
  );

  // Revoke FACILITATOR_ROLE from deployer (granted during init when we passed deployer as facilitator)
  if (await escrowContract.hasRole(FACILITATOR_ROLE, deployer.address)) {
    const tx = await escrowContract.connect(deployer).revokeRole(FACILITATOR_ROLE, deployer.address);
    await tx.wait();
    console.log("  revokeRole(FACILITATOR_ROLE, deployer) tx:", tx.hash);
  } else {
    console.log("  Deployer already lacks FACILITATOR_ROLE.");
  }

  // ============================================================
  // 4. Hand DEFAULT_ADMIN_ROLE (and MAINTAINER_ROLE on ServersV2) to the chain owner.
  //    Done LAST so deployer can complete every setting first.
  //    No-op on chains where deployer == chain owner.
  // ============================================================
  if (chainOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\n=== Transferring admin role(s) to ${chainOwner} ===`);

    const adminTargets = [
      { name: "FeeRegistry", addr: feeReg.proxyAddress, abi: "FeeRegistryImplementation", extraRoles: [] as string[] },
      { name: "ServersV2", addr: serversV2.proxyAddress, abi: "DataPortabilityServersV2Implementation", extraRoles: [MAINTAINER_ROLE] },
      { name: "PermissionsV2", addr: permissionsV2.proxyAddress, abi: "DataPortabilityPermissionsV2Implementation", extraRoles: [] },
      { name: "DataRegistryV2", addr: dataRegistryV2.proxyAddress, abi: "DataRegistryV2Implementation", extraRoles: [] },
      { name: "Escrow", addr: escrow.proxyAddress, abi: "DataPortabilityEscrowImplementation", extraRoles: [] },
    ];

    for (const t of adminTargets) {
      const inst = await ethers.getContractAt(t.abi, t.addr);

      // Grant chain owner ALL relevant roles first, then renounce deployer's.
      for (const role of [DEFAULT_ADMIN_ROLE, ...t.extraRoles]) {
        if (!(await inst.hasRole(role, chainOwner))) {
          const tx = await inst.connect(deployer).grantRole(role, chainOwner);
          await tx.wait();
          console.log(`  ${t.name}.grantRole(${roleLabel(role)}, owner) tx: ${tx.hash}`);
        }
      }
      for (const role of [...t.extraRoles, DEFAULT_ADMIN_ROLE]) {
        // Renounce DEFAULT_ADMIN_ROLE LAST among the contract's roles, so we
        // retain admin while renouncing the others.
        if (await inst.hasRole(role, deployer.address)) {
          const tx = await inst.connect(deployer).renounceRole(role, deployer.address);
          await tx.wait();
          console.log(`  ${t.name}.renounceRole(${roleLabel(role)}, deployer) tx: ${tx.hash}`);
        }
      }
    }
  } else {
    console.log("\n(Skipping admin-role transfer: deployer is already the chain owner.)");
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n=================================================");
  console.log("=== Deployment summary ===");
  console.log("=================================================");
  console.log("FeeRegistry proxy:                ", feeReg.proxyAddress);
  console.log("  impl:                           ", feeReg.implementationAddress);
  console.log("DataPortabilityServersV2 proxy:   ", serversV2.proxyAddress);
  console.log("  impl:                           ", serversV2.implementationAddress);
  console.log("DataPortabilityPermissionsV2 proxy:", permissionsV2.proxyAddress);
  console.log("  impl:                           ", permissionsV2.implementationAddress);
  console.log("DataRegistryV2 proxy:             ", dataRegistryV2.proxyAddress);
  console.log("  impl:                           ", dataRegistryV2.implementationAddress);
  console.log("DataPortabilityEscrow proxy:      ", escrow.proxyAddress);
  console.log("  impl:                           ", escrow.implementationAddress);
};

// ----- helpers -----

async function deployOne(
  deployer: any,
  proxyContractName: string,
  implContractName: string,
  initParams: any[],
  proxyPath: string,
): Promise<DeployResult> {
  console.log(`\n--- Deploying ${proxyContractName} ---`);
  const salt = proxyContractName + SALT_SUFFIX;
  const result = await deterministicDeployProxy(deployer, proxyContractName, implContractName, initParams, salt);
  await verifyProxy(result.proxyAddress, result.implementationAddress, result.initializeData, proxyPath);
  console.log(`${proxyContractName} -> ${result.proxyAddress}  (impl ${result.implementationAddress})`);
  return { proxyAddress: result.proxyAddress, implementationAddress: result.implementationAddress };
}

async function ensureWired(
  label: string,
  reader: () => Promise<string>,
  setter: () => Promise<any>,
  expected: string,
) {
  const current = (await reader()) as string;
  if (current.toLowerCase() === expected.toLowerCase()) {
    console.log(`  ${label} already wired.`);
    return;
  }
  const tx = await setter();
  await tx.wait();
  console.log(`  ${label} tx: ${tx.hash}`);
}

async function ensureGranted(label: string, contract: any, role: string, recipient: string, deployer: any) {
  if (await contract.hasRole(role, recipient)) {
    console.log(`  ${label} already granted.`);
    return;
  }
  const tx = await contract.connect(deployer).grantRole(role, recipient);
  await tx.wait();
  console.log(`  ${label} tx: ${tx.hash}`);
}

function roleLabel(role: string): string {
  if (role === DEFAULT_ADMIN_ROLE) return "DEFAULT_ADMIN_ROLE";
  if (role === MAINTAINER_ROLE) return "MAINTAINER_ROLE";
  if (role === ACCESS_RECORDER_ROLE) return "ACCESS_RECORDER_ROLE";
  if (role === FACILITATOR_ROLE) return "FACILITATOR_ROLE";
  return role;
}

export default func;
func.tags = ["DataPortabilityFullStackDeploy"];
