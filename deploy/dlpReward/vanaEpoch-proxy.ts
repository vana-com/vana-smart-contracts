import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";
import { getCurrentBlockNumber } from "../utils/timeAndBlockManipulation";
import { deployProxy, verifyProxy } from "./helpers";

const implementationContractName = "VanaEpochImplementation";
const proxyContractName = "VanaEpochProxy";
const proxyContractPath = "contracts/vanaEpoch/VanaEpochProxy.sol:VanaEpochProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  // Configuration values
  const daySize = 600; // blocks per day
  const epochSize = 91; // days per epoch
  const epochRewardAmount = parseEther("10"); // 10 VANA per epoch

  // Get DLPRegistry address from previous deployment
  const dlpRegistryAddress = (await deployments.get("DLPRegistryProxy")).address;

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [{
      ownerAddress: ownerAddress,
      dlpRegistryAddress: dlpRegistryAddress,
      daySize: daySize,
      epochSize: epochSize,
      epochRewardAmount: epochRewardAmount
    }],
  );

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** VanaEpoch Deployment Completed **********`);

  const proxy = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
  );

  // Configure the contract
  await proxy.connect(deployer).grantRole(MAINTAINER_ROLE, deployer);

  // Now update the DLPRegistry with the VanaEpoch address
  const dlpRegistry = await ethers.getContractAt(
    "DLPRegistryImplementation",
    dlpRegistryAddress
  );

  await dlpRegistry.connect(deployer).updateVanaEpoch(proxyDeploy.proxyAddress);

  console.log(`VanaEpoch proxy address: ${proxyDeploy.proxyAddress}`);
  console.log(`VanaEpoch implementation address: ${proxyDeploy.implementationAddress}`);
  console.log(`DLPRegistry updated with VanaEpoch address`);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["VanaEpochProxy"];
