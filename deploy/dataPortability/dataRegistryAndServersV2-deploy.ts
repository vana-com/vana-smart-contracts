import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, verifyProxy } from "../helpers";

/**
 * Deploys DataPortabilityServersV2 + DataRegistryV2 on Moksha and wires them:
 *  - DataPortabilityServersV2: initialize(trustedForwarder=0, owner)
 *  - DataRegistryV2:           initialize(owner)
 *  - DataRegistryV2.setDataPortabilityServers(serversV2 proxy)
 *  - DataRegistryV2.grantRole(FACILITATOR_ROLE, owner)
 *
 * Env vars used:
 *   OWNER_ADDRESS               - admin / facilitator address (defaults to deployer)
 *   DATA_REGISTRY_FACILITATOR   - optional; address to grant FACILITATOR_ROLE on DataRegistryV2.
 *                                 Defaults to OWNER_ADDRESS. Can be the gateway / escrow proxy later.
 *   CREATE2_SALT                - optional; defaults to each proxy's contract name.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;
  const facilitatorAddress = process.env.DATA_REGISTRY_FACILITATOR ?? ownerAddress;

  console.log("Deployer:                ", deployer.address);
  console.log("Owner (admin):           ", ownerAddress);
  console.log("DataRegistry facilitator:", facilitatorAddress);

  // ---------------------------------------------------------------
  // 1. DataPortabilityServersV2
  // ---------------------------------------------------------------
  console.log("\n=== Deploying DataPortabilityServersV2 ===");
  const serversImpl = "DataPortabilityServersV2Implementation";
  const serversProxy = "DataPortabilityServersV2Proxy";
  const serversProxyPath =
    "contracts/dataPortability/dataPortabilityServersV2/DataPortabilityServersV2Proxy.sol:DataPortabilityServersV2Proxy";
  const serversSalt = process.env.CREATE2_SALT ?? serversProxy;

  // initialize(trustedForwarderAddress, ownerAddress)
  const serversInitParams = [ethers.ZeroAddress, ownerAddress];

  const serversDeploy = await deterministicDeployProxy(
    deployer,
    serversProxy,
    serversImpl,
    serversInitParams,
    serversSalt,
  );

  await verifyProxy(
    serversDeploy.proxyAddress,
    serversDeploy.implementationAddress,
    serversDeploy.initializeData,
    serversProxyPath,
  );

  console.log("DataPortabilityServersV2 proxy:", serversDeploy.proxyAddress);

  // ---------------------------------------------------------------
  // 2. DataRegistryV2
  // ---------------------------------------------------------------
  console.log("\n=== Deploying DataRegistryV2 ===");
  const registryImpl = "DataRegistryV2Implementation";
  const registryProxy = "DataRegistryV2Proxy";
  const registryProxyPath =
    "contracts/data/dataRegistryV2/DataRegistryV2Proxy.sol:DataRegistryV2Proxy";
  const registrySalt = process.env.CREATE2_SALT ?? registryProxy;

  // initialize(ownerAddress)
  const registryInitParams = [ownerAddress];

  const registryDeploy = await deterministicDeployProxy(
    deployer,
    registryProxy,
    registryImpl,
    registryInitParams,
    registrySalt,
  );

  await verifyProxy(
    registryDeploy.proxyAddress,
    registryDeploy.implementationAddress,
    registryDeploy.initializeData,
    registryProxyPath,
  );

  console.log("DataRegistryV2 proxy:", registryDeploy.proxyAddress);

  // ---------------------------------------------------------------
  // 3. Wire DataRegistryV2 -> DataPortabilityServersV2
  // ---------------------------------------------------------------
  console.log("\n=== Wiring DataRegistryV2.setDataPortabilityServers ===");
  const registryContract = await ethers.getContractAt(
    "DataRegistryV2Implementation",
    registryDeploy.proxyAddress,
  );

  const currentServers: string = await registryContract.dataPortabilityServers();
  if (currentServers.toLowerCase() === serversDeploy.proxyAddress.toLowerCase()) {
    console.log("Already wired.");
  } else {
    const tx = await registryContract
      .connect(deployer)
      .setDataPortabilityServers(serversDeploy.proxyAddress);
    await tx.wait();
    console.log("setDataPortabilityServers tx:", tx.hash);
  }

  const verifyServers: string = await registryContract.dataPortabilityServers();
  if (verifyServers.toLowerCase() !== serversDeploy.proxyAddress.toLowerCase()) {
    throw new Error(
      `setDataPortabilityServers failed: expected ${serversDeploy.proxyAddress}, got ${verifyServers}`,
    );
  }
  console.log("Wiring verified.");

  // ---------------------------------------------------------------
  // 4. Grant FACILITATOR_ROLE on DataRegistryV2
  // ---------------------------------------------------------------
  console.log("\n=== Granting FACILITATOR_ROLE on DataRegistryV2 ===");
  const FACILITATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACILITATOR_ROLE"));
  const hasRole: boolean = await registryContract.hasRole(FACILITATOR_ROLE, facilitatorAddress);
  if (hasRole) {
    console.log("Facilitator already has FACILITATOR_ROLE.");
  } else {
    const grantTx = await registryContract
      .connect(deployer)
      .grantRole(FACILITATOR_ROLE, facilitatorAddress);
    await grantTx.wait();
    console.log("grantRole tx:", grantTx.hash);
  }

  const verifyRole: boolean = await registryContract.hasRole(FACILITATOR_ROLE, facilitatorAddress);
  if (!verifyRole) {
    throw new Error(
      `grantRole failed: ${facilitatorAddress} does not have FACILITATOR_ROLE on DataRegistryV2`,
    );
  }
  console.log("Role grant verified.");

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log("\n=== Deployment summary ===");
  console.log("DataPortabilityServersV2 proxy:", serversDeploy.proxyAddress);
  console.log("  - implementation:           ", serversDeploy.implementationAddress);
  console.log("DataRegistryV2 proxy:         ", registryDeploy.proxyAddress);
  console.log("  - implementation:           ", registryDeploy.implementationAddress);
  console.log("  - dataPortabilityServers:   ", verifyServers);
  console.log("  - FACILITATOR_ROLE granted: ", facilitatorAddress);
};

export default func;
func.tags = ["DataRegistryAndServersV2Deploy"];
