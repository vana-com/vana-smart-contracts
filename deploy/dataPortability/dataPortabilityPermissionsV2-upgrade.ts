import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataPortabilityPermissionsV2 to use OZ's `_domainSeparatorV4()`
 * for both EIP-712 signatures and `grantId` derivation.
 *
 * Storage layout is unchanged (the removed `DOMAIN_TYPEHASH` was a constant,
 * not a storage slot). Safe upgrade.
 *
 * BEHAVIOR CHANGE: the returned `domainSeparator()` value differs from before,
 * so every `grantId(grantor, granteeId)` now derives a different bytes32.
 * Off-chain code that predicted/stored grantIds against the old impl needs
 * to recompute against the EIP-712 standard domain separator.
 */
const PROXY_DEFAULT = "0x8D489bEE1e35cc214F0d9D0F4610905d231218A0";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress = process.env.DATA_PORTABILITY_PERMISSIONS_V2_PROXY ?? PROXY_DEFAULT;

  console.log("Deployer:                  ", deployer.address);
  console.log("PermissionsV2 proxy:       ", proxyAddress);

  // 1. Deploy new impl
  console.log("\n=== Deploying new DataPortabilityPermissionsV2Implementation ===");
  const implDeploy = await deployments.deploy("DataPortabilityPermissionsV2Implementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New implementation:        ", implDeploy.address);

  // 2. Snapshot previous impl
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeImplRaw.slice(-40));
  console.log("Previous impl:             ", beforeImpl);

  // 3. Snapshot a sample grantId BEFORE upgrade so we can show the value change.
  const sampleGrantor = "0x2AC93684679a5bdA03C6160def908CdB8D46792f";
  const sampleGranteeId = "0x" + "00".repeat(31) + "01";
  const proxyOld = await ethers.getContractAt(
    "DataPortabilityPermissionsV2Implementation",
    proxyAddress,
  );
  const grantIdBefore = await proxyOld.grantId(sampleGrantor, sampleGranteeId);
  const domainBefore = await proxyOld.domainSeparator();
  console.log("Pre-upgrade  domainSeparator():", domainBefore);
  console.log("Pre-upgrade  grantId(sample):  ", grantIdBefore);

  // 4. Upgrade
  if (beforeImpl.toLowerCase() === implDeploy.address.toLowerCase()) {
    console.log("Already at this implementation — skipping upgrade.");
  } else {
    console.log("\n=== Calling upgradeToAndCall on proxy ===");
    const tx = await proxyOld.connect(deployer).upgradeToAndCall(implDeploy.address, "0x");
    console.log("upgrade tx:                ", tx.hash);
    await tx.wait();

    const afterImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
    const afterImpl = ethers.getAddress("0x" + afterImplRaw.slice(-40));
    console.log("New impl in proxy:         ", afterImpl);
    if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
      throw new Error(
        `Upgrade did not take effect: proxy impl is ${afterImpl}, expected ${implDeploy.address}`,
      );
    }
  }

  // 5. Snapshot after upgrade
  const grantIdAfter = await proxyOld.grantId(sampleGrantor, sampleGranteeId);
  const domainAfter = await proxyOld.domainSeparator();
  console.log("\n=== Post-upgrade sanity ===");
  console.log("Post-upgrade domainSeparator():", domainAfter);
  console.log("Post-upgrade grantId(sample):  ", grantIdAfter);
  if (domainBefore === domainAfter) {
    console.log("WARNING: domainSeparator unchanged after upgrade — did the new impl land?");
  }

  // 6. Verify on Blockscout (also catches the original impl that was unverified)
  console.log("\n=== Verifying new impl on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Upgrade summary ===");
  console.log("Proxy:                          ", proxyAddress);
  console.log("Previous impl:                  ", beforeImpl);
  console.log("New impl:                       ", implDeploy.address);
};

export default func;
func.tags = ["DataPortabilityPermissionsV2Upgrade"];
