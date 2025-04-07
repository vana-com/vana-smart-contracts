import { ethers, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";
import { parseEther } from "../utils/helpers";

const implementationContractName = "ComputeEngineImplementation";
const proxyContractName = "ComputeEngineProxy";
const proxyContractPath =
    "contracts/computeEngine/ComputeEngineProxy.sol:ComputeEngineProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const queryEngineDeploy = await deployments.get("QueryEngineProxy");

    const dataAccessTreasuryProxyFactoryDeploy = await deployments.get("DataAccessTreasuryProxyFactory");

    const computeInstructionRegistryDeploy = await deployments.get("ComputeInstructionRegistryProxy");

    const computeEngineTeePoolFactoryDeploy = await deployments.get("ComputeEngineTeePoolFactoryProxy");

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const salt = process.env.CREATE2_SALT ?? proxyContractName;

    console.log("Deployer address:", deployer.address);
    console.log("Owner address:", ownerAddress);
    console.log("Query Engine:", queryEngineDeploy.address);
    console.log("dataAccessTreasuryProxyFactory:", dataAccessTreasuryProxyFactoryDeploy.address);
    console.log("computeInstructionRegistry:", computeInstructionRegistryDeploy.address);
    console.log("computeEngineTeePoolFactory:", computeEngineTeePoolFactoryDeploy.address);
    console.log("Salt:", salt);

    const initializeParams = [ownerAddress, queryEngineDeploy.address, computeEngineTeePoolFactoryDeploy.address, dataAccessTreasuryProxyFactoryDeploy.address];

    const proxyDeploy = await deterministicDeployProxy(
        deployer,
        proxyContractName,
        implementationContractName,
        initializeParams,
        salt,
    );

    console.log("initializeData:", proxyDeploy.initializeData);

    // await verifyProxy(
    //     proxyDeploy.proxyAddress,
    //     proxyDeploy.implementationAddress,
    //     proxyDeploy.initializeData,
    //     proxyContractPath,
    // );

    const computeEngine = await ethers.getContractAt("ComputeEngineImplementation", proxyDeploy.proxyAddress);
    await computeEngine.updateInstructionRegistry(computeInstructionRegistryDeploy.address);

    const queryEngine = await ethers.getContractAt("QueryEngineImplementation", queryEngineDeploy.address);
    await queryEngine.updateComputeEngine(proxyDeploy.proxyAddress);

    const computeEngineTeePoolFactory = await ethers.getContractAt("ComputeEngineTeePoolFactoryImplementation", computeEngineTeePoolFactoryDeploy.address);
    await computeEngineTeePoolFactory.updateComputeEngine(proxyDeploy.proxyAddress);

    const dataTreasuryImplementationFactory = await ethers.getContractFactory(
        "DataAccessTreasuryImplementation",
    );

    const computeEngineTreasuryInitializeData = dataTreasuryImplementationFactory.interface.encodeFunctionData(
        "initialize",
        [ownerAddress, proxyDeploy.proxyAddress],
    );

    console.log("computeEngineTreasuryInitializeData", computeEngineTreasuryInitializeData);

    return;
};

export default func;
func.tags = ["ComputeEngineDeploy"];
