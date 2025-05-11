import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract, deployProxy, verifyProxy } from "./helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const DATDeploy = await deployments.deploy("DAT", {
        from: deployer.address,
        args: [],
        log: true,
        // maxFeePerGas: ethers.parseUnits("200", "gwei").toString(),
        // maxPriorityFeePerGas: ethers.parseUnits("100", "gwei").toString(),
    });

    const DATVotesDeploy = await deployments.deploy("DATVotes", {
        from: deployer.address,
        args: [],
        log: true,
    });

    const DATPausableDeploy = await deployments.deploy("DATPausable", {
        from: deployer.address,
        args: [],
        log: true,
    });

    const implementationContractName = "DATFactoryImplementation";
    const proxyContractName = "DATFactoryProxy";
    const proxyContractPath =
        "contracts/dat/DATFactoryProxy.sol:DATFactoryProxy";

    const initializeParams = [ownerAddress, 0, ethers.MaxUint256, DATDeploy.address, DATVotesDeploy.address, DATPausableDeploy.address];

    const proxyDeploy = await deployProxy(
        deployer,
        proxyContractName,
        implementationContractName,
        initializeParams,
    );

    await verifyContract(
        DATDeploy.address,
        [],
    );

    await verifyContract(
        DATVotesDeploy.address,
        [],
    );

    await verifyContract(
        DATPausableDeploy.address,
        [],
    );

    await verifyProxy(
        proxyDeploy.proxyAddress,
        proxyDeploy.implementationAddress,
        proxyDeploy.initializeData,
        proxyContractPath,
    );
};

export default func;
func.tags = ["DATFactoryDeploy"];