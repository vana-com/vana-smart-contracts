import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployBeaconProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";

const implementationContractName = "ComputeEngineTeePoolImplementation";
const beaconContractName = "ComputeEngineTeePoolFactoryBeacon";
const beaconContractPath =
    "contracts/computeEngineTeePool/ComputeEngineTeePoolBeaconProxy.sol:ComputeEngineTeePoolFactoryBeacon";

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
