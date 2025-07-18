import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, verifyProxy } from "../helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  console.log("Deployer address:", deployer.address);
  console.log("Owner address:", ownerAddress);

  const dataRegistryContractAddress = process.env.DATA_REGISTRY_CONTRACT_ADDRESS;
  if (!dataRegistryContractAddress) {
    throw new Error("DATA_REGISTRY_CONTRACT_ADDRESS is not defined in the environment variables.");
  }

  // Deploy DataPortabilityServers first (no dependencies)
  console.log("\n=== Deploying DataPortabilityServers ===");
  const serversImplementationContractName = "DataPortabilityServersImplementation";
  const serversProxyContractName = "DataPortabilityServersProxy";
  const serversProxyContractPath = "contracts/dataPortability/dataPortabilityServers/DataPortabilityServersProxy.sol:DataPortabilityServersProxy";
  const serversSalt = process.env.CREATE2_SALT ?? serversProxyContractName;

  const serversInitializeParams = [ethers.ZeroAddress, ownerAddress];

  const serversProxyDeploy = await deterministicDeployProxy(
    deployer,
    serversProxyContractName,
    serversImplementationContractName,
    serversInitializeParams,
    serversSalt,
  );

  await verifyProxy(
    serversProxyDeploy.proxyAddress,
    serversProxyDeploy.implementationAddress,
    serversProxyDeploy.initializeData,
    serversProxyContractPath,
  );

  console.log("DataPortabilityServers deployed at:", serversProxyDeploy.proxyAddress);

  // Deploy DataPortabilityGrantees (no dependencies)
  console.log("\n=== Deploying DataPortabilityGrantees ===");
  const granteesImplementationContractName = "DataPortabilityGranteesImplementation";
  const granteesProxyContractName = "DataPortabilityGranteesProxy";
  const granteesProxyContractPath = "contracts/dataPortability/dataPortabilityGrantees/DataPortabilityGranteesProxy.sol:DataPortabilityGranteesProxy";
  const granteesSalt = process.env.CREATE2_SALT ?? granteesProxyContractName;

  const granteesInitializeParams = [ethers.ZeroAddress, ownerAddress];

  const granteesProxyDeploy = await deterministicDeployProxy(
    deployer,
    granteesProxyContractName,
    granteesImplementationContractName,
    granteesInitializeParams,
    granteesSalt,
  );

  await verifyProxy(
    granteesProxyDeploy.proxyAddress,
    granteesProxyDeploy.implementationAddress,
    granteesProxyDeploy.initializeData,
    granteesProxyContractPath,
  );

  console.log("DataPortabilityGrantees deployed at:", granteesProxyDeploy.proxyAddress);

  // Deploy DataPortabilityPermissions (depends on Servers and Grantees)
  console.log("\n=== Deploying DataPortabilityPermissions ===");
  const permissionsImplementationContractName = "DataPortabilityPermissionsImplementation";
  const permissionsProxyContractName = "DataPortabilityPermissionsProxy";
  const permissionsProxyContractPath = "contracts/dataPortability/dataPortabilityPermissions/DataPortabilityPermissionsProxy.sol:DataPortabilityPermissionsProxy";
  const permissionsSalt = process.env.CREATE2_SALT ?? permissionsProxyContractName;

  const permissionsInitializeParams = [
    ethers.ZeroAddress,
    ownerAddress,
    dataRegistryContractAddress,
    serversProxyDeploy.proxyAddress,
    granteesProxyDeploy.proxyAddress,
  ];

  const permissionsProxyDeploy = await deterministicDeployProxy(
    deployer,
    permissionsProxyContractName,
    permissionsImplementationContractName,
    permissionsInitializeParams,
    permissionsSalt,
  );

  await verifyProxy(
    permissionsProxyDeploy.proxyAddress,
    permissionsProxyDeploy.implementationAddress,
    permissionsProxyDeploy.initializeData,
    permissionsProxyContractPath,
  );

  console.log("DataPortabilityPermissions deployed at:", permissionsProxyDeploy.proxyAddress);

  console.log("\n=== All DataPortability contracts deployed successfully! ===");
  console.log("DataPortabilityServers:", serversProxyDeploy.proxyAddress);
  console.log("DataPortabilityGrantees:", granteesProxyDeploy.proxyAddress);
  console.log("DataPortabilityPermissions:", permissionsProxyDeploy.proxyAddress);

  return;
};

export default func;
func.tags = ["DataPortabilityInitDeploy"];