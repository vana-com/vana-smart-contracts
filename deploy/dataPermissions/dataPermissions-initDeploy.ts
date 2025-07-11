import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, deployProxy, getNextDeploymentAddress, verifyProxy } from "../helpers";

const implementationContractName = "DataPermissionsImplementation";
const proxyContractName = "DataPermissionsProxy";
const proxyContractPath =
  "contracts/dataPermissions/DataPermissionsProxy.sol:DataPermissionsProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const salt = process.env.CREATE2_SALT ?? proxyContractName;

  console.log("Deployer address:", deployer.address);
  console.log("Owner address:", ownerAddress);
  console.log("Salt:", salt);

  const dataRegistryContractAddress = process.env.DATA_REGISTRY_CONTRACT_ADDRESS;
  if (!dataRegistryContractAddress) {
    throw new Error("DATA_REGISTRY_CONTRACT_ADDRESS is not defined in the environment variables.");
  }

  const initializeParams = [ethers.ZeroAddress, ownerAddress, dataRegistryContractAddress];

  const proxyDeploy = await deterministicDeployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    initializeParams,
    salt,
  );

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["DataPermissionsInitDeploy"];
