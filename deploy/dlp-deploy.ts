import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyContract, verifyProxy } from "./helpers";
import { getReceipt, parseEther } from "../utils/helpers";
import { EventLog } from "ethers";

const implementationContractName = "DataLiquidityPoolImplementation";
const proxyContractName = "DataLiquidityPoolProxy";
const proxyContractPath =
  "contracts/dlp/DataLiquidityPoolProxy.sol:DataLiquidityPoolProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const trustedForwarderAddress =
    process.env.TRUSTED_FORWARDER_ADDRESS ?? deployer.address;

  const tokenName = process.env.DLP_TOKEN_NAME ?? "Custom Data Autonomy Token";
  const tokenSymbol = process.env.DLP_TOKEN_SYMBOL ?? "CUSTOMDAT";
  const tokenSalt = process.env.DLP_TOKEN_SALT ?? "customDataAutonomyToken";
  const tokenCap = process.env.DLP_TOKEN_CAP ?? parseEther(1_000_000_000);
  const datType = process.env.DAT_TYPE ?? 0;

  const teePoolContractAddress = process.env.TEE_POOL_CONTRACT_ADDRESS ?? "";
  const dataRegistryContractAddress =
    process.env.DATA_REGISTRY_CONTRACT_ADDRESS ?? "";

  const datFactoryContractAddress =
    process.env.DAT_FACTORY_CONTRACT_ADDRESS ?? "";
  const datFactoryContract = await ethers.getContractAt(
    "DATFactoryImplementation",
    datFactoryContractAddress,
  );

  const dlpPubicKey = process.env.DLP_PUBLIC_KEY ?? "pubicKey";
  const proofInstruction =
    process.env.DLP_PROOF_INSTRUCTION ?? "proofInstruction";
  const dlpName = process.env.DLP_NAME ?? "DLP Name";
  const dlpFileRewardFactor =
    process.env.DLP_FILE_REWARD_FACTOR ?? parseEther(1);

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploying DAT **********`);

  console.log(`DAT Factory Address: ${datFactoryContractAddress}`);
  console.log(`DLP Token Name: ${tokenName}`);
  console.log(`DLP Token Symbol: ${tokenSymbol}`);
  console.log(`DLP Token Cap: ${tokenCap}`);
  console.log(`DLP Token Salt: ${tokenSalt}`);
  console.log(`DLP Type: ${datType}`);
  console.log(`Owner Address: ${ownerAddress}`);
  console.log(`Trusted Forwarder Address: ${trustedForwarderAddress}`);

  const tx = await datFactoryContract.createToken({
    datType: datType,
    name: tokenName,
    symbol: tokenSymbol,
    cap: tokenCap,
    schedules: [],
    salt: ethers.id(tokenSalt),
    owner: ownerAddress,
  });
  const receipt = await getReceipt(tx);

  const createEvent = receipt.logs.find(
    (log) => (log as EventLog).fragment?.name === "DATCreated",
  ) as EventLog;

  const tokenAddress = createEvent.args[0];
  console.log(`Token Address: ${tokenAddress}`);

  const params = {
    trustedForwarder: trustedForwarderAddress,
    ownerAddress: ownerAddress,
    tokenAddress: tokenAddress,
    dataRegistryAddress: dataRegistryContractAddress,
    teePoolAddress: teePoolContractAddress,
    name: dlpName,
    publicKey: dlpPubicKey,
    proofInstruction: proofInstruction,
    fileRewardFactor: dlpFileRewardFactor,
  };

  console.log(`DLP Params: ${JSON.stringify(params)}`);

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [params],
  );

  console.log("Proxy deployed to:", proxyDeploy.proxyAddress);

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
