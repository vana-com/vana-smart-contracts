import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyContract, verifyProxy } from "./helpers";
import { parseEther } from "../utils/helpers";
import { formatEther } from "ethers";

const implementationContractName = "DataLiquidityPoolImplementation";
const proxyContractName = "DataLiquidityPoolProxy";
const proxyContractPath =
  "contracts/dlp/DataLiquidityPoolProxy.sol:DataLiquidityPoolProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS || deployer.address;

  const trustedForwarderAddress =
    process.env.TRUSTED_FORWARDER_ADDRESS || deployer.address;

  const tokenName = process.env.DLP_TOKEN_NAME || "Custom DAT Points";
  const tokenSymbol = process.env.DLP_TOKEN_SYMBOL || "CUSTOMDATP";
  const tokenCap = parseEther(process.env.DLP_TOKEN_CAP || 0); // 0 for no cap

  const teePoolContractAddress = process.env.TEE_POOL_CONTRACT_ADDRESS || "";
  const dataRegistryContractAddress =
    process.env.DATA_REGISTRY_CONTRACT_ADDRESS || "";

  const dlpPubicKey = process.env.DLP_PUBLIC_KEY || "pubicKey";
  const proofInstruction =
    process.env.DLP_PROOF_INSTRUCTION || "proofInstruction";
  const dlpName = process.env.DLP_NAME || "DLP Name";
  const dlpFileRewardFactor =
    process.env.DLP_FILE_REWARD_FACTOR || parseEther(1);

  console.log(``);
  console.log(`********** Deploying DATPoints Token **********`);

  console.log(`DLP Token Name: ${tokenName}`);
  console.log(`DLP Token Symbol: ${tokenSymbol}`);
  console.log(`DLP Token Cap: ${tokenCap == 0n ? "No cap" : formatEther(tokenCap)}`);
  console.log(`Owner Address: ${ownerAddress}`);
  console.log(`Trusted Forwarder Address: ${trustedForwarderAddress}`);

  // Deploy DATPoints token
  const DATPoints = await ethers.getContractFactory("DATPoints");
  const token = await DATPoints.deploy(
    tokenName,
    tokenSymbol,
    deployer.address,
    tokenCap
  );
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log(`DATPoints Token deployed to: ${tokenAddress}`);

  // Verify DATPoints token contract
  console.log("Starting DATPoints token verification...");
  await verifyContract(
    tokenAddress,
    [tokenName, tokenSymbol, deployer.address, tokenCap.toString()],
    "contracts/dlpTemplates/dat/DATPoints.sol:DATPoints"
  );

  console.log(``);
  console.log(`********** Deploying DataLiquidityPool **********`);

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

  // console.log(``);
  // console.log(`********** Mint tokens for contributor rewards **********`);
  //
  // // Get contract instances
  // const dlp = await ethers.getContractAt(
  //   "DataLiquidityPoolImplementation",
  //   proxyDeploy.proxyAddress,
  // );
  //
  // console.log(`Minting 1,000,000 tokens to deployer...`);
  // const txMint = await token
  //   .connect(deployer)
  //   .mint(deployer.address, parseEther(1000000));
  // await txMint.wait();
  // console.log(`✅ Tokens minted successfully`);
  //
  // console.log(`Approving DLP to spend 1,000,000 tokens...`);
  // const txApprove = await token
  //   .connect(deployer)
  //   .approve(proxyDeploy.proxyAddress, parseEther(1000000));
  // await txApprove.wait();
  // console.log(`✅ Approval granted successfully`);
  //
  // console.log(`Adding 1,000,000 tokens as rewards for contributors...`);
  // const txAddRewards = await dlp
  //   .connect(deployer)
  //   .addRewardsForContributors(parseEther(1000000));
  // await txAddRewards.wait();
  // console.log(`✅ Rewards added successfully`);
  //
  // console.log(`Granting roles to ${ownerAddress}...`);
  //
  // // Define role constants
  // const DEFAULT_ADMIN_ROLE =
  //   "0x0000000000000000000000000000000000000000000000000000000000000000";
  // const MINTER_ROLE =
  //   "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
  //
  // // Grant DEFAULT_ADMIN_ROLE to ownerAddress
  // const txGrantAdminRole = await token
  //   .connect(deployer)
  //   .grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
  // await txGrantAdminRole.wait();
  // console.log(`✅ DEFAULT_ADMIN_ROLE granted to ${ownerAddress}`);
  //
  // // Grant MINTER_ROLE to ownerAddress
  // const txGrantMinterRole = await token
  //   .connect(deployer)
  //   .grantRole(MINTER_ROLE, ownerAddress);
  // await txGrantMinterRole.wait();
  // console.log(`✅ MINTER_ROLE granted to ${ownerAddress}`);
  //
  // // Revoke roles from deployer if different from ownerAddress
  // if (deployer.address !== ownerAddress) {
  //   console.log(`Revoking deployer roles...`);
  //
  //   const txRevokeMinterRole = await token
  //     .connect(deployer)
  //     .revokeRole(MINTER_ROLE, deployer.address);
  //   await txRevokeMinterRole.wait();
  //   console.log(`✅ MINTER_ROLE revoked from deployer`);
  //
  //   const txRevokeAdminRole = await token
  //     .connect(deployer)
  //     .revokeRole(DEFAULT_ADMIN_ROLE, deployer.address);
  //   await txRevokeAdminRole.wait();
  //   console.log(`✅ DEFAULT_ADMIN_ROLE revoked from deployer`);
  // }
  //
  // console.log("\n✅ Deployment Summary:");
  // console.log(`   📦 DATPoints Token deployed at: ${tokenAddress}`);
  // console.log(
  //   `   🧠 ${proxyContractName} proxy is live at: ${proxyDeploy.proxyAddress}`,
  // );
  // console.log(
  //   "🚀 All components deployed and verified (or attempted). Ready to roll!",
  // );

  return;
};

export default func;
func.tags = ["DLPPoints"];
