import { ethers, run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyContract, verifyProxy } from "./helpers";
import { getReceipt, parseEther } from "../utils/helpers";
import { EventLog, formatEther } from "ethers";

const implementationContractName = "DataLiquidityPoolImplementation";
const proxyContractName = "DataLiquidityPoolProxy";
const proxyContractPath =
  "contracts/dlp/DataLiquidityPoolProxy.sol:DataLiquidityPoolProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS || deployer.address;

  const trustedForwarderAddress =
    process.env.TRUSTED_FORWARDER_ADDRESS || deployer.address;

  const beneficiaryAddress =
    process.env.VESTING_BENEFICIARY || ownerAddress;

  const tokenName = process.env.DLP_TOKEN_NAME || "Custom Data Autonomy Token";
  const tokenSymbol = process.env.DLP_TOKEN_SYMBOL || "CUSTOMDAT";
  // Generate a random salt for the token if not provided in the environment variables
  const tokenSalt =
    process.env.DLP_TOKEN_SALT ||
    `DLP_TOKEN_SALT_${Math.floor(Math.random() * 1000000).toString()}`;
  const tokenCap = process.env.DLP_TOKEN_CAP || parseEther(1_000_000_000);
  const datType = process.env.DAT_TYPE || 0;

  const teePoolContractAddress = process.env.TEE_POOL_CONTRACT_ADDRESS || "";
  const dataRegistryContractAddress =
    process.env.DATA_REGISTRY_CONTRACT_ADDRESS || "";

  const datFactoryContractAddress =
    process.env.DAT_FACTORY_CONTRACT_ADDRESS || "";
  const datFactoryContract = await ethers.getContractAt(
    "DATFactoryImplementation",
    datFactoryContractAddress,
  );

  const dlpPubicKey = process.env.DLP_PUBLIC_KEY || "pubicKey";
  const proofInstruction =
    process.env.DLP_PROOF_INSTRUCTION || "proofInstruction";
  const dlpName = process.env.DLP_NAME || "DLP Name";
  const dlpFileRewardFactor =
    process.env.DLP_FILE_REWARD_FACTOR || parseEther(1);

  console.log(``);
  console.log(`********** Deploying DAT **********`);

  console.log(`DAT Factory Address: ${datFactoryContractAddress}`);
  console.log(`DLP Token Name: ${tokenName}`);
  console.log(`DLP Token Symbol: ${tokenSymbol}`);
  console.log(`DLP Token Cap: ${formatEther(tokenCap)}`);
  console.log(`DLP Token Salt: ${tokenSalt}`);
  console.log(`DLP Type: ${datType}`);
  console.log(`Owner Address: ${ownerAddress}`);
  console.log(`Vesting Address: ${beneficiaryAddress}`);
  console.log(`Trusted Forwarder Address: ${trustedForwarderAddress}`);

  const secondsInYear = 60 * 60 * 24 * 365;
  const secondsInMonth = 60 * 60 * 24 * 30;
  const vestingStart = process.env.VESTING_START
    ? parseInt(process.env.VESTING_START)
    : Math.floor(Date.now() / 1000);

  const vestingAmount = parseEther(process.env.VESTING_AMOUNT || 0);

  if (BigInt(vestingAmount) > BigInt(tokenCap)) {
    throw new Error(
      `Vesting amount ${formatEther(vestingAmount)} exceeds token cap ${formatEther(tokenCap)}`,
    );
  }

  const vestingDuration = process.env.VESTING_DURATION
    ? parseInt(process.env.VESTING_DURATION)
    : 3 * secondsInYear; // 3 years
  const vestingCliff = process.env.VESTING_CLIFF
    ? parseInt(process.env.VESTING_CLIFF)
    : 6 * secondsInMonth; // 6 months

  const tx = await datFactoryContract.createToken({
    datType: datType,
    name: tokenName,
    symbol: tokenSymbol,
    cap: tokenCap,
    schedules: [
      {
        beneficiary: beneficiaryAddress,
        start: vestingStart,
        cliff: vestingCliff,
        duration: vestingDuration,
        amount: vestingAmount,
      },
    ],
    salt: ethers.id(tokenSalt),
    owner: deployer.address,
  });
  const receipt = await getReceipt(tx);

  const createEvent = receipt.logs.find(
    (log) => (log as EventLog).fragment?.name === "DATCreated",
  ) as EventLog;

  const tokenAddress = createEvent.args[0];
  console.log(`Token Address: ${tokenAddress}`);

  const vestingWalletCreatedEvent = receipt.logs.find(
    (log) => (log as EventLog).fragment?.name === "VestingWalletCreated",
  ) as EventLog;
  const vestingWalletAddress = vestingWalletCreatedEvent.args[0];
  console.log(`Vesting Wallet Address: ${vestingWalletAddress}`);

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

  console.log(`${proxyContractName} deployed to:`, proxyDeploy.proxyAddress);

  console.log("Starting contract verification...");
  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  console.log("Attempting to verify vesting wallet contract...");
  try {
    await run("verify:verify", {
      address: vestingWalletAddress,
      force: true,
      constructorArguments: [
        beneficiaryAddress,
        vestingStart + vestingCliff,
        vestingDuration - vestingCliff,
      ],
    });
  } catch (e) {
    console.log("Vesting wallet verification failed or already verified:");
    console.log(e);
  }

  // Added minting section here
  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`********** Mint tokens for contributor rewards **********`);

  // Get contract instances
  const token = await ethers.getContractAt("DAT", tokenAddress);
  const dlp = await ethers.getContractAt("DataLiquidityPoolImplementation", proxyDeploy.proxyAddress);

  console.log(`Minting 1,000,000 tokens to deployer...`);
  const txMint = await token
    .connect(deployer)
    .mint(deployer, parseEther(1000000));
  await txMint.wait();
  console.log(`✅ Tokens minted successfully`);

  console.log(`Approving DLP to spend 1,000,000 tokens...`);
  const txApprove = await token
    .connect(deployer)
    .approve(proxyDeploy.proxyAddress, parseEther(1000000));
  await txApprove.wait();
  console.log(`✅ Approval granted successfully`);

  console.log(`Adding 1,000,000 tokens as rewards for contributors...`);
  const txAddRewards = await dlp
    .connect(deployer)
    .addRewardsForContributors(parseEther(1000000));
  await txAddRewards.wait();
  console.log(`✅ Rewards added successfully`);

  console.log(`Granting roles to ${ownerAddress}...`);

  // Define role constants
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

  // Grant DEFAULT_ADMIN_ROLE to ownerAddress
  const txGrantAdminRole = await token
    .connect(deployer)
    .grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
  await txGrantAdminRole.wait();
  console.log(`✅ DEFAULT_ADMIN_ROLE granted to ${ownerAddress}`);

  // Grant MINTER_ROLE to ownerAddress
  const txGrantMinterRole = await token
    .connect(deployer)
    .grantRole(MINTER_ROLE, ownerAddress);
  await txGrantMinterRole.wait();
  console.log(`✅ MINTER_ROLE granted to ${ownerAddress}`);

  // Revoke roles from deployer if different from ownerAddress
  if (deployer.address !== ownerAddress) {
    console.log(`Revoking deployer roles...`);

    const txRevokeMinterRole = await token
      .connect(deployer)
      .revokeRole(MINTER_ROLE, deployer.address);
    await txRevokeMinterRole.wait();
    console.log(`✅ MINTER_ROLE revoked from deployer`);

    const txRevokeAdminRole = await token
      .connect(deployer)
      .revokeRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await txRevokeAdminRole.wait();
    console.log(`✅ DEFAULT_ADMIN_ROLE revoked from deployer`);
  }

  console.log("\n✅ Deployment Summary:");
  console.log(`   📦 Token successfully deployed at: ${tokenAddress}`);
  console.log(`   🧠 ${proxyContractName} proxy is live at: ${proxyDeploy.proxyAddress}`);
  console.log(`   🎁 Vesting wallet set up at: ${vestingWalletAddress}`);
  console.log(`   💰 1,000,000 tokens minted and added as rewards`);
  console.log(`   👑 Roles granted to: ${ownerAddress} (DEFAULT_ADMIN_ROLE + MINTER_ROLE)`);
  console.log("🚀 All components deployed and verified (or attempted). Ready to roll!");

  return;
};

export default func;
func.tags = ["DLPDeploy"];