import { ethers, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";

const implementationContractName = "ComputeEngineTeePoolFactoryImplementation";
const proxyContractName = "ComputeEngineTeePoolFactoryProxy";
const proxyContractPath =
    "contracts/computeEngineTeePoolFactory/ComputeEngineTeePoolFactoryProxy.sol:ComputeEngineTeePoolFactoryProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const salt = process.env.CREATE2_SALT ?? proxyContractName;

    const teePoolProxyFactory = await deployments.get("ComputeEngineTeePoolProxyFactory");
    const ephemeralTimeout = 5 * 60; // 5 minutes
    const persistentTimeout = 2 * 60 * 60; // 2 hour

    console.log("Deployer address:", deployer.address);
    console.log("Owner address:", ownerAddress);
    console.log("teePoolProxyFactory:", teePoolProxyFactory.address);

    const initializeParams = [ownerAddress, teePoolProxyFactory.address, ephemeralTimeout, persistentTimeout];

    const proxyDeploy = await deterministicDeployProxy(
        deployer,
        proxyContractName,
        implementationContractName,
        initializeParams,
        salt,
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
