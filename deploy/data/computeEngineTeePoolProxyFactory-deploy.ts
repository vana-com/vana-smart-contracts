import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import {
  deployBeaconProxy,
  getNextDeploymentAddress,
  verifyProxy,
} from "../helpers";

const implementationContractName = "ComputeEngineTeePoolImplementation";
const beaconContractName = "ComputeEngineTeePoolProxyFactory";
const beaconContractPath =
  "contracts/computeEngineTeePool/ComputeEngineTeePoolProxyFactory.sol:ComputeEngineTeePoolProxyFactory";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const salt = process.env.CREATE2_SALT ?? beaconContractName;

  console.log("Deployer address:", deployer.address);
  console.log("Owner address:", ownerAddress);
  console.log("Salt:", salt);

  const beaconDeploy = await deployBeaconProxy(
    deployer,
    beaconContractName,
    implementationContractName,
    ownerAddress,
    salt,
  );

  await verifyProxy(
    beaconDeploy.beaconAddress,
    beaconDeploy.implementationAddress,
    ownerAddress,
    beaconContractPath,
  );

  return;
};

export default func;
func.tags = ["ComputeEngineTeePoolProxyFactoryDeploy"];
