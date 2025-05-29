import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";

const implementationContractName = "ComputeInstructionRegistryImplementation";
const proxyContractName = "ComputeInstructionRegistryProxy";
const proxyContractPath =
  "contracts/computeInstructionRegistry/ComputeInstructionRegistryProxy.sol:ComputeInstructionRegistryProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const salt = process.env.CREATE2_SALT ?? proxyContractName;

  const dlpRootCoreContractAddress = process.env.DLP_ROOT_CORE_CONTRACT_ADDRESS;
  if (!dlpRootCoreContractAddress) {
    throw new Error("DLP_ROOT_CORE_CONTRACT_ADDRESS is not defined in the environment variables.");
  }

  console.log("Deployer address:", deployer.address);
  console.log("Owner address:", ownerAddress);
  console.log("DLP_ROOT_CORE_CONTRACT_ADDRESS:", dlpRootCoreContractAddress);

  const initializeParams = [ownerAddress, dlpRootCoreContractAddress];

  const proxyDeploy = await deterministicDeployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    initializeParams,
    salt,
  );

  console.log("initializeData:", proxyDeploy.initializeData);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["ComputeInstructionRegistryDeploy"];
