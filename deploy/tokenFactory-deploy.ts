import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

/**
 * Deploy the DATFactory contract and verify it
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
  
  log("\n✅  DATFactory deployment and verification complete");
};

export default func;
func.tags = ["DATFactory"];
