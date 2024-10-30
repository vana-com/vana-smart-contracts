import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";
import { getCurrentBlockNumber } from "../utils/timeAndBlockManipulation";
import { deployProxy, verifyProxy } from "./helpers";

const implementationContractName = "DLPRootImplementation";
const proxyContractName = "DLPRootProxy";
const proxyContractPath = "contracts/root/DLPRootProxy.sol:DLPRootProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const epochDlpsLimit = 16;
  const eligibleDlpsLimit = 300;
  let daySize = 3600 / 8;
  let epochSize = daySize * 21;
  const minStakeAmount = parseEther("0.001");
  const minDlpStakersPercentage = parseEther("50");
  const minDlpRegistrationStake = parseEther("10");
  const dlpEligibilityThreshold = parseEther("1000");
  const dlpSubEligibilityThreshold = parseEther("500");
  const stakeWithdrawalDelay = daySize * 10;
  const rewardClaimDelay = daySize * 7;
  const startBlock = (await getCurrentBlockNumber()) + (3600 * 24) / 8;
  let epochRewardAmount = parseEther("2");

  const initializeParams = {
    ownerAddress: deployer.address,
    eligibleDlpsLimit: eligibleDlpsLimit,
    epochDlpsLimit: epochDlpsLimit,
    minStakeAmount: minStakeAmount,
    minDlpStakersPercentage: minDlpStakersPercentage,
    minDlpRegistrationStake: minDlpRegistrationStake,
    dlpEligibilityThreshold: dlpEligibilityThreshold,
    dlpSubEligibilityThreshold: dlpSubEligibilityThreshold,
    stakeWithdrawalDelay: stakeWithdrawalDelay,
    rewardClaimDelay: rewardClaimDelay,
    startBlock: startBlock,
    epochSize: epochSize,
    daySize: daySize,
    epochRewardAmount: epochRewardAmount,
  };

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [initializeParams],
  );

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Add reward and transfer ownership **********`);

  const proxy = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
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
func.tags = ["DLPRootDeploy"];
