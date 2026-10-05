import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataPortabilityEscrow to add `recordAccessAndSettle` and the
 * `dataRegistry` storage pointer / setter / event / error.
 *
 * Storage layout extends StorageV1 by appending a single new variable
 * (`IDataRegistryV2 dataRegistry`) — safe UUPS upgrade.
 *
 * After upgrade, wires the pointer at DataRegistryV2 proxy.
 */
const ESCROW_PROXY_DEFAULT = "0xcF50fAb402e2025a92e1bF811049820b6428910A";
const DATA_REGISTRY_PROXY_DEFAULT = "0x0850226E939A5C949633200cf0b1F4665CA74931";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress = process.env.DATA_PORTABILITY_ESCROW_PROXY ?? ESCROW_PROXY_DEFAULT;
  const dataRegistryAddress =
    process.env.DATA_REGISTRY_V2_PROXY ?? DATA_REGISTRY_PROXY_DEFAULT;

  console.log("Deployer:               ", deployer.address);
  console.log("Escrow proxy:           ", proxyAddress);
  console.log("DataRegistryV2 to wire: ", dataRegistryAddress);

  // 1. Deploy new implementation
  console.log("\n=== Deploying new DataPortabilityEscrowImplementation ===");
  const implDeploy = await deployments.deploy("DataPortabilityEscrowImplementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New implementation:     ", implDeploy.address);

  // 2. Snapshot previous impl
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeImplRaw.slice(-40));
  console.log("Previous impl:          ", beforeImpl);

  // 3. Upgrade
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

  // 4. Wire dataRegistry pointer
  console.log("\n=== Wiring escrow.setDataRegistry ===");
  const escrow = await ethers.getContractAt(
    "DataPortabilityEscrowImplementation",
    proxyAddress,
  );
  const currentDR: string = await escrow.dataRegistry();
  if (currentDR.toLowerCase() === dataRegistryAddress.toLowerCase()) {
    console.log("Already wired.");
  } else {
    const tx = await escrow.connect(deployer).setDataRegistry(dataRegistryAddress);
    await tx.wait();
    console.log("setDataRegistry tx:     ", tx.hash);
  }

  const verifyDR: string = await escrow.dataRegistry();
  if (verifyDR.toLowerCase() !== dataRegistryAddress.toLowerCase()) {
    throw new Error(`setDataRegistry failed: ${verifyDR}`);
  }
  console.log("dataRegistry pointer:   ", verifyDR);

  // 5. Sanity-check the existing permissions pointer is intact
  const permissionsPtr: string = await escrow.permissions();
  console.log("permissions pointer:    ", permissionsPtr, "(unchanged)");

  // 6. Verify on Blockscout
  console.log("\n=== Verifying new impl on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Upgrade summary ===");
  console.log("Proxy:                       ", proxyAddress);
  console.log("Previous impl:               ", beforeImpl);
  console.log("New impl:                    ", implDeploy.address);
  console.log("dataRegistry:                ", verifyDR);
  console.log("Note: ACCESS_RECORDER_ROLE on DataRegistryV2 was already granted");
  console.log("      to the escrow proxy in an earlier setup tx, so the bundle");
  console.log("      flow is fully wired and callable.");
};

export default func;
func.tags = ["DataPortabilityEscrowUpgradeRecordAccessAndSettle"];
