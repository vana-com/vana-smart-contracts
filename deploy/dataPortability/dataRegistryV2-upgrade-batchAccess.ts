import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataRegistryV2 to add `recordDataAccessBatch` (skip-and-emit
 * batch of `recordDataAccess`), the `DataAccessSkipped` event, the
 * `EmptyBatch` / `BatchTooLarge` errors and the `MAX_ACCESS_BATCH` constant.
 *
 * Storage layout unchanged (no new state variables; constants, events and
 * errors only) — safe UUPS upgrade. `recordDataAccess` keeps its exact
 * revert behaviour; only its state-mutating tail was factored into
 * `_commitAccess`, shared with the batch path.
 *
 * DO NOT RUN before the Nethermind audit slot for this upgrade has cleared.
 * Run this BEFORE the escrow upgrade: the escrow's
 * `recordAccessAndSettleBatch` calls `recordDataAccessBatch` and reverts on
 * a registry that does not have it yet.
 */
const PROXY_DEFAULT = "0x0850226E939A5C949633200cf0b1F4665CA74931";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress = process.env.DATA_REGISTRY_V2_PROXY ?? PROXY_DEFAULT;

  console.log("Deployer:            ", deployer.address);
  console.log("DataRegistryV2 proxy:", proxyAddress);

  console.log("\n=== Deploying new DataRegistryV2Implementation ===");
  const implDeploy = await deployments.deploy("DataRegistryV2Implementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New implementation:  ", implDeploy.address);

  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeImplRaw.slice(-40));
  console.log("Previous impl:       ", beforeImpl);

  if (beforeImpl.toLowerCase() === implDeploy.address.toLowerCase()) {
    console.log("Already at this implementation.");
  } else {
    console.log("\n=== Calling upgradeToAndCall on proxy ===");
    const proxyAsUUPS = await ethers.getContractAt(
      "DataRegistryV2Implementation",
      proxyAddress,
    );
    const tx = await proxyAsUUPS.connect(deployer).upgradeToAndCall(implDeploy.address, "0x");
    console.log("upgrade tx:         ", tx.hash);
    await tx.wait();

    const afterImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
    const afterImpl = ethers.getAddress("0x" + afterImplRaw.slice(-40));
    console.log("New impl in proxy:  ", afterImpl);
    if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
      throw new Error(`Upgrade did not take effect`);
    }
  }

  const registry = await ethers.getContractAt("DataRegistryV2Implementation", proxyAddress);
  console.log("MAX_ACCESS_BATCH:    ", (await registry.MAX_ACCESS_BATCH()).toString());

  console.log("\n=== Verifying on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Upgrade summary ===");
  console.log("Proxy:                  ", proxyAddress);
  console.log("Previous impl:          ", beforeImpl);
  console.log("New impl:               ", implDeploy.address);
};

export default func;
func.tags = ["DataRegistryV2UpgradeBatchAccess"];
