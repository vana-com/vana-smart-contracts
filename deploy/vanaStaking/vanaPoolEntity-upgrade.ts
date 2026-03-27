import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const implementationContractName = "VanaPoolEntityImplementation";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const proxyAddress = process.env.VANA_POOL_ENTITY_PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error("VANA_POOL_ENTITY_PROXY_ADDRESS environment variable is required");
  }

  console.log(`Using VanaPoolEntity proxy at: ${proxyAddress}`);
  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);

  // Fetch current gas price and apply 10x multiplier for faster inclusion
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = (feeData.gasPrice ?? 0n) * 10n;
  console.log(`Using gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei (10x current)`);

  // Track nonce manually to replace any stuck pending txs
  let nonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  const pendingNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  console.log(`Confirmed nonce: ${nonce}, Pending nonce: ${pendingNonce}`);

  function txOverrides() {
    return { gasPrice, nonce: nonce++ };
  }

  // Step 1: Deploy new implementation
  console.log(`\n********** Step 1: Deploy new ${implementationContractName} **********`);

  const deployOverrides = txOverrides();
  const implementationDeploy = await deployments.deploy(
    implementationContractName,
    {
      from: deployer.address,
      args: [],
      log: true,
      gasPrice: gasPrice.toString(),
      nonce: deployOverrides.nonce,
    },
  );

  console.log(`${implementationContractName} deployed at: ${implementationDeploy.address}`);

  await delay(6000);

  await verifyContract(implementationDeploy.address, []);

  const deployOnly = process.env.DEPLOY_ONLY === "true";
  if (deployOnly) {
    console.log(`\nDEPLOY_ONLY=true — skipping upgrade.`);
    console.log(`New implementation address: ${implementationDeploy.address}`);
    console.log(`To upgrade via multisig, call upgradeToAndCall(${implementationDeploy.address}, "0x") on ${proxyAddress}`);
    return;
  }

  // Step 2: Upgrade (no initializeV2 needed — totalDistributedRewards starts at 0)
  console.log(`\n********** Step 2: Upgrade to new implementation **********`);

  const upgradeTx = await proxy.upgradeToAndCall(
    implementationDeploy.address,
    "0x",
    { from: deployer.address, ...txOverrides() },
  );
  const receipt = await upgradeTx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Upgrade transaction failed");
  }
  console.log("Upgrade confirmed.");

  const version = await proxy.version();
  console.log(`Contract version: ${version}`);

  console.log(`\nNext step: call addTotalDistributedRewards() to seed historical values.`);
  console.log(`Use scripts/vanaStaking/calculateDistributedRewards.ts to compute them.`);
};

export default func;
func.tags = ["VanaPoolEntityUpgrade"];
