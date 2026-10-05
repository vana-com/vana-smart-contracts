import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataPortabilityEscrow to add `recordAccessAndSettleBatch`
 * (N access records + their payment legs in one tx), the `AccessSettled`
 * marker event, the `EmptyBatch` / `BatchTooLarge` errors and the
 * `MAX_ACCESS_BATCH` constant.
 *
 * Storage layout unchanged (no new state variables) — safe UUPS upgrade.
 * No new roles: FACILITATOR_ROLE gates the new entry point exactly as it
 * gates `recordAccessAndSettle`.
 *
 * DO NOT RUN before the Nethermind audit slot for this upgrade has cleared.
 * Run AFTER `DataRegistryV2UpgradeBatchAccess`: the new escrow function
 * calls `dataRegistry.recordDataAccessBatch`, which the pre-upgrade registry
 * does not have (the call would revert with no data).
 */
const ESCROW_PROXY_DEFAULT = "0xcF50fAb402e2025a92e1bF811049820b6428910A";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress = process.env.DATA_PORTABILITY_ESCROW_PROXY ?? ESCROW_PROXY_DEFAULT;

  console.log("Deployer:               ", deployer.address);
  console.log("Escrow proxy:           ", proxyAddress);

  console.log("\n=== Deploying new DataPortabilityEscrowImplementation ===");
  const implDeploy = await deployments.deploy("DataPortabilityEscrowImplementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New implementation:     ", implDeploy.address);

  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeImplRaw.slice(-40));
  console.log("Previous impl:          ", beforeImpl);

  if (beforeImpl.toLowerCase() === implDeploy.address.toLowerCase()) {
    console.log("Already at this implementation.");
  } else {
    console.log("\n=== Calling upgradeToAndCall on proxy ===");
    const proxyAsUUPS = await ethers.getContractAt(
      "DataPortabilityEscrowImplementation",
      proxyAddress,
    );
    const tx = await proxyAsUUPS.connect(deployer).upgradeToAndCall(implDeploy.address, "0x");
    console.log("upgrade tx:            ", tx.hash);
    await tx.wait();

    const afterImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
    const afterImpl = ethers.getAddress("0x" + afterImplRaw.slice(-40));
    if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
      throw new Error(`Upgrade did not take effect: ${afterImpl}`);
    }
    console.log("New impl in proxy:      ", afterImpl);
  }

  const escrow = await ethers.getContractAt("DataPortabilityEscrowImplementation", proxyAddress);
  const registryAddress: string = await escrow.dataRegistry();
  console.log("dataRegistry pointer:   ", registryAddress, "(unchanged)");
  console.log("permissions pointer:    ", await escrow.permissions(), "(unchanged)");
  console.log("MAX_ACCESS_BATCH:       ", (await escrow.MAX_ACCESS_BATCH()).toString());

  // Guard: the wired registry must already expose the batch entry point.
  const registry = await ethers.getContractAt("DataRegistryV2Implementation", registryAddress);
  const registryMax = await registry.MAX_ACCESS_BATCH();
  console.log("registry MAX_ACCESS_BATCH", registryMax.toString());

  console.log("\n=== Verifying new impl on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Upgrade summary ===");
  console.log("Proxy:                       ", proxyAddress);
  console.log("Previous impl:               ", beforeImpl);
  console.log("New impl:                    ", implDeploy.address);
};

export default func;
func.tags = ["DataPortabilityEscrowUpgradeBatchAccess"];
