import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract, deterministicDeployProxy, verifyProxy } from "./helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS || deployer.address;

    const salt = process.env.CREATE2_SALT || "DATFactoryProxySalt";

    const DATDeploy = await deployments.deploy("DAT", {
        from: deployer.address,
        args: [],
        log: true,
        deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(salt)),
        // maxFeePerGas: ethers.parseUnits("200", "gwei").toString(),
        // maxPriorityFeePerGas: ethers.parseUnits("100", "gwei").toString(),
    });

    const DATVotesDeploy = await deployments.deploy("DATVotes", {
        from: deployer.address,
        args: [],
        log: true,
        deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(salt)),
    });

    const DATPausableDeploy = await deployments.deploy("DATPausable", {
        from: deployer.address,
        args: [],
        log: true,
        deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(salt)),
    });

    const implementationContractName = "DATFactoryImplementation";
    const proxyContractName = "DATFactoryProxy";
    const proxyContractPath =
        "contracts/dat/DATFactoryProxy.sol:DATFactoryProxy";

    const MaxUint208 = (1n << 208n) - 1n;
    const initializeParams = [ownerAddress, 1, MaxUint208, DATDeploy.address, DATVotesDeploy.address, DATPausableDeploy.address];

    const proxyDeploy = await deterministicDeployProxy(
        deployer,
        proxyContractName,
        implementationContractName,
        initializeParams,
        salt,
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