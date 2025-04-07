import { ethers, run, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";
import { parseEther } from "../utils/helpers";

const implementationContractName = "QueryEngineImplementation";
const proxyContractName = "QueryEngineProxy";
const proxyContractPath =
    "contracts/queryEngine/QueryEngineProxy.sol:QueryEngineProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const dataRefinerRegistry = await deployments.get("DataRefinerRegistryProxy");

    const dataAccessTreasuryProxyFactoryDeploy = await deployments.get("DataAccessTreasuryProxyFactory");

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const salt = process.env.CREATE2_SALT ?? proxyContractName;

    console.log("Deployer address:", deployer.address);
    console.log("Owner address:", ownerAddress);
    console.log("dataRefinerRegistry:", dataRefinerRegistry.address);
    console.log("dataAccessTreasuryProxyFactory:", dataAccessTreasuryProxyFactoryDeploy.address);
    console.log("Salt:", salt);

    const initializeParams = [ownerAddress, dataRefinerRegistry.address, dataAccessTreasuryProxyFactoryDeploy.address];

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

    const dataTreasuryImplementationFactory = await ethers.getContractFactory(
        "DataAccessTreasuryImplementation",
    );

    const queryEngine = await ethers.getContractAt("QueryEngineImplementation", proxyDeploy.proxyAddress);

    await queryEngine.updateDlpPaymentPercentage(parseEther(80));
    await queryEngine.updateVanaTreasury(ownerAddress);

    const dataAccessTreasuryProxyFactory = await ethers.getContractAt(
        "DataAccessTreasuryProxyFactory",
        dataAccessTreasuryProxyFactoryDeploy.address,
    );

    const queryEngineTreasuryInitializeData = dataTreasuryImplementationFactory.interface.encodeFunctionData(
        "initialize",
        [ownerAddress, proxyDeploy.proxyAddress],
    );

    console.log("queryEngineTreasuryInitializeData", queryEngineTreasuryInitializeData);

    try {
        await run("verify:verify", {
            address: await queryEngine.queryEngineTreasury(),
            force: true,
            constructorArguments: [dataAccessTreasuryProxyFactoryDeploy.address, queryEngineTreasuryInitializeData],
        });
    } catch (e) {
        console.log(e);
    }


    return;
};

export default func;
func.tags = ["QueryEngineDeploy"];
