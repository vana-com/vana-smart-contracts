import { ethers, deployments } from "hardhat";
import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, verifyProxy } from "./helpers";

const implementationContractName = "SwapHelperImplementation";
const proxyContractName = "SwapHelperProxy";
const proxyContractPath =
    "contracts/swapHelper/SwapHelperProxy.sol:SwapHelperProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const salt = process.env.CREATE2_SALT ?? proxyContractName;

    // Use ZeroAddress for UniswapV3Router and UniswapV3Quoter because their addresses
    // are different on Moksha and mainnet. After deployment, we will update them.
    const initializeParams = [ownerAddress, ethers.ZeroAddress, ethers.ZeroAddress];

    const proxyDeploy = await deterministicDeployProxy(
        deployer,
        proxyContractName,
        implementationContractName,
        initializeParams,
        salt,
    );

    console.log("initializeData:", proxyDeploy.initializeData);

    await verifyProxy(
        proxyDeploy.proxyAddress,
        proxyDeploy.implementationAddress,
        proxyDeploy.initializeData,
        proxyContractPath,
    );

    return;
};

export default func;
func.tags = ["SwapHelperDeploy"];
