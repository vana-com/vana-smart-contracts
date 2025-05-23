import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyProxy } from "./helpers";

const implementationContractName = "TeePoolImplementation";
const proxyContractName = "TeePoolProxy";
const proxyContractPath = "contracts/teePool/TeePoolProxy.sol:TeePoolProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS || deployer.address;
  const dataRegistryContractAddress =
    process.env.DATA_REGISTRY_CONTRACT_ADDRESS || ethers.ZeroAddress;
  const trustedForwarderAddress =
    process.env.TRUSTED_FORWARDER_ADDRESS || ethers.ZeroAddress;

  const initialCancelDelay = 100; // 100 blocks

  const initializeParams = [
    trustedForwarderAddress,
    ownerAddress,
    dataRegistryContractAddress,
    initialCancelDelay,
  ];

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
func.tags = ["TeePoolDeploy"];
