import { ethers, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";

const implementationContractName = "ComputeEngineTeePoolFactoryImplementation";
const proxyContractName = "ComputeEngineTeePoolFactoryProxy";
const proxyContractPath =
    "contracts/computeEngineTeePoolFactory/ComputeEngineTeePoolFactoryProxy.sol:ComputeEngineTeePoolFactoryProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const teePoolProxyFactoryBeacon = await deployments.get("ComputeEngineTeePoolFactoryBeacon");
    const ephemeralTimeout = 5 * 60; // 5 minutes
    const persistentTimeout = 2 * 60 * 60; // 2 hour

    console.log("Deployer address:", deployer.address);
    console.log("Owner address:", ownerAddress);
    console.log("teePoolProxyFactoryBeacon:", teePoolProxyFactoryBeacon.address);

    const initializeParams = [ownerAddress, teePoolProxyFactoryBeacon.address, ephemeralTimeout, persistentTimeout];

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
func.tags = ["ComputeEngineTeePoolFactoryDeploy"];
