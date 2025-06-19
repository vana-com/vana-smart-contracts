import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";
import { getCurrentBlockNumber } from "../utils/timeAndBlockManipulation";
import { deployProxy, verifyProxy } from "./helpers";

const implementationContractName = "DLPRewardDeployerImplementation";
const proxyContractName = "DLPRewardDeployerProxy";
const proxyContractPath = "contracts/dlpRewardDeployer/DLPRewardDeployerProxy.sol:DLPRewardDeployerProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  // Configuration values
  const numberOfTranches = 90;
  const rewardPercentage = parseEther("60");
  const maximumSlippage = parseEther("10");

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [
      ownerAddress,
      (await deployments.get("DLPRegistryProxy")).address,
      (await deployments.get("VanaEpochProxy")).address,
      '0x7c6862C46830F0fc3bF3FF509EA1bD0EE7267fB0',
      numberOfTranches,
      rewardPercentage,
      maximumSlippage
    ],
  );

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** DLP RewardDeployer Deployment Completed **********`);

  const proxy = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
  );

  // Configure the contract
  await proxy.connect(deployer).grantRole(MAINTAINER_ROLE, deployer);

  console.log(`RewardDeployer proxy address: ${proxyDeploy.proxyAddress}`);
  console.log(`RewardDeployer implementation address: ${proxyDeploy.implementationAddress}`);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["DLPRewardDeployerProxy"];