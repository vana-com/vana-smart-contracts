import { ethers, upgrades, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

const implementationContractName = "ComputeEngineTeePoolImplementation";
const beaconContractName = "ComputeEngineTeePoolFactoryBeacon";
const beaconContractPath =
    "contracts/computeEngineTeePool/ComputeEngineTeePoolBeaconProxy.sol:ComputeEngineTeePoolFactoryBeacon";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const teePoolProxyBeacon = await deployments.get(beaconContractName);
    const teePoolImplementationFactory = await ethers.getContractFactory(implementationContractName);
    await upgrades.upgradeBeacon(teePoolProxyBeacon.address, teePoolImplementationFactory);

    const newImplementationAddress = await upgrades.beacon.getImplementationAddress(teePoolProxyBeacon.address);
    
    console.log("New implementation address:", newImplementationAddress);

    await verifyContract(newImplementationAddress, []);

    return;
};

export default func;
func.tags = ["ComputeEngineTeePoolProxyFactoryUpgrade"];
