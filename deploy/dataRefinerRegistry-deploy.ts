import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";

const implementationContractName = "DataRefinerRegistryImplementation";
const proxyContractName = "DataRefinerRegistryProxy";
const proxyContractPath =
  "contracts/dataRefinerRegistry/DataRefinerRegistryProxy.sol:DataRefinerRegistryProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const dlpRootCoreContractAddress = process.env.DLP_ROOT_CORE_CONTRACT_ADDRESS;
  if (!dlpRootCoreContractAddress) {
    throw new Error("DLP_ROOT_CORE_CONTRACT_ADDRESS is not defined in the environment variables.");
  }

  console.log("Deployer address:", deployer.address);
  console.log("Owner address:", ownerAddress);
  console.log("DLP_ROOT_CORE_CONTRACT_ADDRESS:", dlpRootCoreContractAddress);

  const initializeParams = [ownerAddress, dlpRootCoreContractAddress];

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    initializeParams,
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
func.tags = ["DataRefinerRegistryDeploy"];
