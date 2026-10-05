import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataRegistryV2 to add `setStatusWithSignature`:
 *   - new EIP-712 typehash: SET_STATUS_TYPEHASH
 *   - new view: statusSequence(owner, scope)
 *   - new write: setStatusWithSignature(owner, scope, newStatus, expectedSequence, signature)
 *   - new event: StatusSignedByDelegate(id, ownerAddress, delegate)
 *   - storage append: _statusSequences (UUPS-safe)
 *
 * Same dual-signer model as addDataWithSignature: owner OR trusted personal
 * server. Sequence counter is independent of currentVersion so data writes
 * and status flips don't invalidate each other's pending signatures.
 *
 * Per chain:
 *   - Moksha:  deployer has admin -> upgradeToAndCall
 *   - Mainnet: deployer has no admin -> deploys impl only, prints calldata
 */
const REGISTRY_PROXY = "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867";
const MAINNET_ADMIN = "0x5ECA5208F29e32879a711467916965B2D753bAf4";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(hre.network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);

  console.log("Deployer:        ", deployer.address);
  console.log("Chain:           ", hre.network.name, `(chainId=${chainId})`);
  console.log("Registry proxy:  ", REGISTRY_PROXY);

  console.log("\n=== Deploying new DataRegistryV2Implementation ===");
  const implDeploy = await deployments.deploy("DataRegistryV2Implementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New impl:        ", implDeploy.address);

  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeRaw = await ethers.provider.getStorage(REGISTRY_PROXY, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeRaw.slice(-40));
  console.log("Current impl:    ", beforeImpl);
  if (beforeImpl.toLowerCase() === implDeploy.address.toLowerCase()) {
    console.log("Already at this implementation — nothing to do.");
    return;
  }

  const DEFAULT_ADMIN_ROLE = "0x" + "00".repeat(32);
  const proxyAsImpl = await ethers.getContractAt("DataRegistryV2Implementation", REGISTRY_PROXY);
  const canUpgrade: boolean = await proxyAsImpl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

  if (canUpgrade) {
    console.log("\n=== Deployer has admin — performing upgradeToAndCall ===");
    const tx = await proxyAsImpl.connect(deployer).upgradeToAndCall(implDeploy.address, "0x");
    console.log("upgrade tx:      ", tx.hash);
    await tx.wait();

    const afterRaw = await ethers.provider.getStorage(REGISTRY_PROXY, IMPL_SLOT);
    const afterImpl = ethers.getAddress("0x" + afterRaw.slice(-40));
    if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
      throw new Error(`Upgrade did not take effect: ${afterImpl}`);
    }
    console.log("Confirmed: proxy now at", afterImpl);

    // Sanity-check new surface.
    const typehash = await proxyAsImpl.SET_STATUS_TYPEHASH();
    console.log("SET_STATUS_TYPEHASH:", typehash);
  } else {
    const admin = await proxyAsImpl.hasRole(DEFAULT_ADMIN_ROLE, MAINNET_ADMIN);
    console.log("\n=== Deployer does NOT have admin ===");
    if (admin) console.log(`Confirmed: ${MAINNET_ADMIN} has DEFAULT_ADMIN_ROLE.`);
    console.log("Calldata for admin wallet:");
    const iface = new ethers.Interface(["function upgradeToAndCall(address,bytes)"]);
    const data = iface.encodeFunctionData("upgradeToAndCall", [implDeploy.address, "0x"]);
    console.log("  to:    " + REGISTRY_PROXY);
    console.log("  data:  " + data);
    console.log("  value: 0");
  }

  console.log("\n=== Verifying new impl on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Summary ===");
  console.log("Proxy:           ", REGISTRY_PROXY);
  console.log("Previous impl:   ", beforeImpl);
  console.log("New impl:        ", implDeploy.address);
};

export default func;
func.tags = ["DataRegistryV2UpgradeSetStatusWithSignature"];
