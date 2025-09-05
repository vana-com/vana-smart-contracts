import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import {
  deployBeaconProxy,
  getNextDeploymentAddress,
  verifyProxy,
} from "../helpers";

const implementationContractName = "DataAccessTreasuryImplementation";
const beaconContractName = "DataAccessTreasuryFactoryBeacon";
const beaconContractPath =
  "contracts/dataAccessTreasury/DataAccessTreasuryBeaconProxy.sol:DataAccessTreasuryFactoryBeacon";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  console.log("Deployer address:", deployer.address);
  console.log("Owner address:", ownerAddress);

  const beaconDeploy = await deployBeaconProxy(
    deployer,
    beaconContractName,
    implementationContractName,
    ownerAddress,
  );

  return;
};

export default func;
func.tags = ["DataAccessTreasuryBeaconProxyDeploy"];
