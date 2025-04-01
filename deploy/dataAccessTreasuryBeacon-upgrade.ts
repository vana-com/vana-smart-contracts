import { ethers, upgrades, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

const implementationContractName = "DataAccessTreasuryImplementation";
const beaconContractName = "DataAccessTreasuryFactoryBeacon";
const beaconContractPath =
    "contracts/dataAccessTreasury/DataAccessTreasuryBeaconProxy.sol:DataAccessTreasuryFactoryBeacon";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const beacon = await deployments.get(beaconContractName);
    const implementationFactory = await ethers.getContractFactory(implementationContractName);
    await upgrades.upgradeBeacon(beacon.address, implementationFactory);

    await delay(6000);

    const newImplementationAddress = await upgrades.beacon.getImplementationAddress(beacon.address);

    console.log("New implementation address:", newImplementationAddress);

    await verifyContract(newImplementationAddress, []);

    return;
};

export default func;
func.tags = ["DataAccessTreasuryProxyFactoryUpgrade"];
