import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyProxy } from "./helpers";
import { parseEther } from "../utils/helpers";

const implementationContractName = "DataLiquidityPoolImplementation";
const proxyContractName = "DataLiquidityPoolProxy";
const proxyContractPath =
  "contracts/dlp/DataLiquidityPoolProxy.sol:DataLiquidityPoolProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const tokenContractName = "DAT";
  const tokenName = process.env.DLP_TOKEN_NAME ?? "Custom Data Autonomy Token";
  const tokenSymbol = process.env.DLP_TOKEN_SYMBOL ?? "CUSTOMDAT";

  const teePoolContractAddress = process.env.TEE_POOL_CONTRACT_ADDRESS ?? "";
  const dataRegistryContractAddress = process.env.DATA_REGISTRY_CONTRACT_ADDRESS ?? "";

  const dlpMasterKey = process.env.DLP_MASTER_KEY ?? "masterKey";
  const dlpName = process.env.DLP_NAME ?? "DLP Name";

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploying DAT **********`);

  const tokenDeploy = await deployments.deploy(tokenContractName, {
    from: deployer.address,
    args: [tokenName, tokenSymbol, deployer.address],
    log: true,
  });

  const token = await ethers.getContractAt("DAT", tokenDeploy.address);
  const dataRegistry = await ethers.getContractAt(
    "DataRegistryImplementation",
    dataRegistryContractAddress,
  );
  const teePool = await ethers.getContractAt(
    "TeePoolImplementation",
    teePoolContractAddress,
  );

  const params = {
    ownerAddress: ownerAddress,
    name: dlpName,
    dataRegistryAddress: dataRegistry.target,
    teePoolAddress: teePool.target,
    tokenAddress: token.target,
    masterKey: dlpMasterKey,
    fileRewardFactor: parseEther(10),
  };

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [params],
  );

  const dlp = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
  );

  await token.connect(deployer).mint(deployer, parseEther(100000000));
  await token.connect(deployer).approve(dlp, parseEther(1000000));
  await dlp.connect(deployer).addRewardsForContributors(parseEther(1000000));

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["DLPDeploy"];
