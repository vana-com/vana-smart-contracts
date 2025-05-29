import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

/**
 * Deploy the DATFactory contract and verify it
 * 
 * The DATFactory is a factory contract that deploys:
 * 1. ERC-20 token clones (DAT) using minimal proxies (EIP-1167)
 * 2. OpenZeppelin VestingWallet contracts for token distribution
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { log } = deployments;
  const [deployer] = await ethers.getSigners();

  /* ───────────────────────────── signers ──────────────────────────────── */
  log("Deployer:", deployer.address);

  /* ─────────────────────────── deploy factory ─────────────────────────── */
  log("\n**************************************************************");
  log("Deploying DATFactory...");
  
  const factoryDeploy = await deployments.deploy("DATFactory", {
    from: deployer.address,
    args: [],
    log: true,
  });

  log("DATFactory deployed →", factoryDeploy.address);

  /* ─────────────────────────── verify factory ─────────────────────────── */
  log("Verifying DATFactory contract...");
  await verifyContract(factoryDeploy.address, []);
  
  const factory = await ethers.getContractAt("DATFactory", factoryDeploy.address);
  log("DATFactory implementation address:", await factory.implementation());
  
  log("\n✅  DATFactory deployment and verification complete");
  log("\nTo deploy a token with vesting, run:");
  log("npx hardhat deploy --tags DATToken");
};

export default func;
func.tags = ["DATFactory"];
