import { ethers, deployments } from "hardhat";
import { ZeroAddress } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, verifyProxy } from "./helpers";

const implementationContractName = "DLPRewardSwapImplementation";
const proxyContractName = "DLPRewardSwapProxy";
const proxyContractPath =
    "contracts/dlpRewardSwap/DLPRewardSwapProxy.sol:DLPRewardSwapProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const [deployer] = await ethers.getSigners();

    const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

    const salt = process.env.CREATE2_SALT ?? proxyContractName;

    const swapHelperDeploy = await deployments.get("SwapHelperProxy");

    // Use ZeroAddress for INonfungiblePositionManager because their addresses
    // are different on Moksha and mainnet. After deployment, we will update them.
    const initializeParams = [ownerAddress, swapHelperDeploy.address, ethers.ZeroAddress];

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
func.tags = ["DlpRewardSwapDeploy"];
