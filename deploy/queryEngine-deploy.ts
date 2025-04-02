import { ethers, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, getNextDeploymentAddress, verifyProxy } from "./helpers";
import { parseEther } from "../utils/helpers";

const implementationContractName = "QueryEngineImplementation";
const proxyContractName = "QueryEngineProxy";
const proxyContractPath =
    "contracts/queryEngine/QueryEngineProxy.sol:QueryEngineProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    // await deployments.fixture("DataRefinerRegistryDeploy");
    const dataRefinerRegistry = await deployments.get("DataRefinerRegistryProxy");

    // await deployments.fixture("DataAccessTreasuryBeaconProxyDeploy");
    const dataAccessTreasuryFactory = await deployments.get("DataAccessTreasuryFactoryBeacon");

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    console.log("Deployer address:", deployer.address);
    console.log("Owner address:", ownerAddress);
    console.log("dataRefinerRegistry:", dataRefinerRegistry.address);
    console.log("dataAccessTreasuryFactory:", dataAccessTreasuryFactory.address);

    const initializeParams = [ownerAddress, dataRefinerRegistry.address, dataAccessTreasuryFactory.address];

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

    const queryEngine = await ethers.getContractAt("QueryEngineImplementation", proxyDeploy.proxyAddress);
    await queryEngine.updateDlpPaymentPercentage(parseEther(80));
    await queryEngine.updateVanaTreasury(ownerAddress);

    return;
};

export default func;
func.tags = ["QueryEngineDeploy"];
