import { ethers, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";
import { parseEther } from "../utils/helpers";

const implementationContractName = "ComputeEngineImplementation";
const proxyContractName = "ComputeEngineProxy";
const proxyContractPath =
    "contracts/computeEngine/ComputeEngineProxy.sol:ComputeEngineProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const queryEngineDeploy = await deployments.get("QueryEngineProxy");

    const dataAccessTreasuryFactory = await deployments.get("DataAccessTreasuryFactoryBeacon");

    const computeInstructionRegistry = await deployments.get("ComputeInstructionRegistryProxy");

    const computeEngineTeePoolFactoryDeploy = await deployments.get("ComputeEngineTeePoolFactoryProxy");

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    console.log("Deployer address:", deployer.address);
    console.log("Owner address:", ownerAddress);
    console.log("Query Engine:", queryEngineDeploy.address);
    console.log("dataAccessTreasuryFactory:", dataAccessTreasuryFactory.address);
    console.log("computeInstructionRegistry:", computeInstructionRegistry.address);

    const initializeParams = [ownerAddress, queryEngineDeploy.address, computeEngineTeePoolFactoryDeploy.address, dataAccessTreasuryFactory.address];

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

    const computeEngine = await ethers.getContractAt("ComputeEngineImplementation", proxyDeploy.proxyAddress);
    await computeEngine.updateInstructionRegistry(computeInstructionRegistry.address);

    const queryEngine = await ethers.getContractAt("QueryEngineImplementation", queryEngineDeploy.address);
    await queryEngine.updateComputeEngine(proxyDeploy.proxyAddress);

    const computeEngineTeePoolFactory = await ethers.getContractAt("ComputeEngineTeePoolFactoryImplementation", computeEngineTeePoolFactoryDeploy.address);
    await computeEngineTeePoolFactory.updateComputeEngine(proxyDeploy.proxyAddress);

    return;
};

export default func;
func.tags = ["ComputeEngineDeploy"];
