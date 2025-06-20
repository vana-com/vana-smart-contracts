import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";
import { getCurrentBlockNumber } from "../utils/timeAndBlockManipulation";
import { deployProxy, verifyProxy } from "./helpers";

const implementationContractName = "TreasuryImplementation";
const proxyContractName = "DLPRewardDeployerTreasuryProxy";
const proxyContractPath = "contracts/treasury/DLPRewardDeployerTreasuryProxy.sol:DLPRewardDeployerTreasuryProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  // Get DLPRegistry address from previous deployment
  const dlpRewardDeployerAddress = (await deployments.get("DLPRewardDeployerProxy")).address;

  // Update the DLPRegistry with the Treasury address
  const dlpRewardDeployer = await ethers.getContractAt(
    "DLPRewardDeployerImplementation",
    dlpRewardDeployerAddress
  );

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [ownerAddress, dlpRewardDeployerAddress],
  );

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Treasury Deployment Completed **********`);

  const proxy = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
  );

  await dlpRewardDeployer.connect(deployer).updateTreasury(proxyDeploy.proxyAddress);

  console.log(`Treasury proxy address: ${proxyDeploy.proxyAddress}`);
  console.log(`Treasury implementation address: ${proxyDeploy.implementationAddress}`);
  console.log(`DLPRegistry updated with Treasury address`);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["DLPRewardDeployerTreasuryProxy"];