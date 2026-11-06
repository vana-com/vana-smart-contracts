import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, verifyProxy } from "../helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;
  // Default to ownerAddress for the initial facilitator; can be rotated later
  // via grantRole(FACILITATOR_ROLE, ...).
  const facilitatorAddress = process.env.FACILITATOR_ADDRESS ?? ownerAddress;

  console.log("Deployer address:    ", deployer.address);
  console.log("Owner address:       ", ownerAddress);
  console.log("Facilitator address: ", facilitatorAddress);

  // ----------------------------------------------------------------
  // 1. DataPortabilityPermissionsV2
  // ----------------------------------------------------------------
  console.log("\n=== Deploying DataPortabilityPermissionsV2 ===");
  const permissionsImpl = "DataPortabilityPermissionsV2Implementation";
  const permissionsProxy = "DataPortabilityPermissionsV2Proxy";
  const permissionsProxyPath =
    "contracts/dataPortability/dataPortabilityPermissionsV2/DataPortabilityPermissionsV2Proxy.sol:DataPortabilityPermissionsV2Proxy";
  const permissionsSalt = process.env.CREATE2_SALT ?? permissionsProxy;

  const permissionsInitParams = [ownerAddress];

  const permissionsDeploy = await deterministicDeployProxy(
    deployer,
    permissionsProxy,
    permissionsImpl,
    permissionsInitParams,
    permissionsSalt,
  );

  await verifyProxy(
    permissionsDeploy.proxyAddress,
    permissionsDeploy.implementationAddress,
    permissionsDeploy.initializeData,
    permissionsProxyPath,
  );

  console.log("DataPortabilityPermissionsV2 deployed at:", permissionsDeploy.proxyAddress);

  // ----------------------------------------------------------------
  // 2. DataPortabilityEscrow
  // ----------------------------------------------------------------
  console.log("\n=== Deploying DataPortabilityEscrow ===");
  const escrowImpl = "DataPortabilityEscrowImplementation";
  const escrowProxy = "DataPortabilityEscrowProxy";
  const escrowProxyPath =
    "contracts/dataPortability/dataPortabilityEscrow/DataPortabilityEscrowProxy.sol:DataPortabilityEscrowProxy";
  const escrowSalt = process.env.CREATE2_SALT ?? escrowProxy;

  const escrowInitParams = [ownerAddress, facilitatorAddress];

  const escrowDeploy = await deterministicDeployProxy(
    deployer,
    escrowProxy,
    escrowImpl,
    escrowInitParams,
    escrowSalt,
  );

  await verifyProxy(
    escrowDeploy.proxyAddress,
    escrowDeploy.implementationAddress,
    escrowDeploy.initializeData,
    escrowProxyPath,
  );

  console.log("DataPortabilityEscrow deployed at:", escrowDeploy.proxyAddress);

  // ----------------------------------------------------------------
  // 3. Wire escrow -> permissions
  // ----------------------------------------------------------------
  console.log("\n=== Wiring escrow.setPermissions(permissions) ===");
  const escrowContract = await ethers.getContractAt(
    "DataPortabilityEscrowImplementation",
    escrowDeploy.proxyAddress,
  );

  const currentPermissions: string = await escrowContract.permissions();
  if (currentPermissions.toLowerCase() === permissionsDeploy.proxyAddress.toLowerCase()) {
    console.log("Already wired.");
  } else {
    const tx = await escrowContract
      .connect(deployer)
      .setPermissions(permissionsDeploy.proxyAddress);
    await tx.wait();
    console.log("setPermissions tx:", tx.hash);
  }

  const verifyPermissions: string = await escrowContract.permissions();
  if (verifyPermissions.toLowerCase() !== permissionsDeploy.proxyAddress.toLowerCase()) {
    throw new Error(
      `setPermissions failed: expected ${permissionsDeploy.proxyAddress}, got ${verifyPermissions}`,
    );
  }
  console.log("Wiring verified.");

  // ----------------------------------------------------------------
  // Summary
  // ----------------------------------------------------------------
  console.log("\n=== Deployment summary ===");
  console.log("DataPortabilityPermissionsV2:", permissionsDeploy.proxyAddress);
  console.log("  - implementation:          ", permissionsDeploy.implementationAddress);
  console.log("DataPortabilityEscrow:       ", escrowDeploy.proxyAddress);
  console.log("  - implementation:          ", escrowDeploy.implementationAddress);
  console.log("  - permissions ptr:         ", verifyPermissions);
};

export default func;
func.tags = ["DataPortabilityV2Deploy"];
