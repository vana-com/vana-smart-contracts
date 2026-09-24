import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const implementationContractName = "VanaPoolStakingImplementation";

/**
 * Upgrades the VanaPoolStaking proxy to the current implementation (v4) and,
 * optionally, backfills the registrant floor for entities created before it
 * existed. Upgrade ORDER matters: VanaPoolEntity must already be upgraded
 * (Staking calls VanaPoolEntity.vanaToShares / previewActiveRewardPool).
 *
 * Env:
 *   VANA_POOL_STAKING_PROXY_ADDRESS  (required)
 *   DEPLOY_ONLY=true                 deploy the implementation only; print the multisig calls
 *   BACKFILL_REGISTRATIONS           optional "entityId:registrant:shares,..." (wei shares)
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress = process.env.VANA_POOL_STAKING_PROXY_ADDRESS;
  if (!proxyAddress) throw new Error("VANA_POOL_STAKING_PROXY_ADDRESS environment variable is required");

  console.log(`Using VanaPoolStaking proxy at: ${proxyAddress}`);
  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);
  console.log(`Current version: ${await proxy.version()}`);

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = (feeData.gasPrice ?? 0n) * 10n;
  let nonce = await ethers.provider.getTransactionCount(deployer.address, "latest");
  const txOverrides = () => ({ gasPrice, nonce: nonce++ });

  console.log(`\n********** Step 1: Deploy new ${implementationContractName} **********`);
  const deployOverrides = txOverrides();
  const implementationDeploy = await deployments.deploy(implementationContractName, {
    from: deployer.address, args: [], log: true, gasPrice: gasPrice.toString(), nonce: deployOverrides.nonce,
  });
  console.log(`${implementationContractName} deployed at: ${implementationDeploy.address}`);
  await delay(6000);
  await verifyContract(implementationDeploy.address, []);

  const backfills = (process.env.BACKFILL_REGISTRATIONS || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [id, registrant, shares] = s.split(":"); return { id: BigInt(id), registrant, shares: BigInt(shares) }; });

  if (process.env.DEPLOY_ONLY === "true") {
    console.log(`\nDEPLOY_ONLY=true — skipping upgrade. Multisig calls, in order:`);
    console.log(`  1. ${proxyAddress}.upgradeToAndCall(${implementationDeploy.address}, "0x")`);
    backfills.forEach((b, i) => console.log(`  ${i + 2}. ${proxyAddress}.backfillRegistration(${b.id}, ${b.registrant}, ${b.shares})`));
    return;
  }

  console.log(`\n********** Step 2: Upgrade **********`);
  const upgradeTx = await proxy.upgradeToAndCall(implementationDeploy.address, "0x", txOverrides());
  const receipt = await upgradeTx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Upgrade transaction failed");
  console.log(`Upgrade confirmed. version = ${await proxy.version()}`);

  if (backfills.length) {
    console.log(`\n********** Step 3: Backfill registrant floors (legacy entities) **********`);
    for (const b of backfills) {
      if ((await proxy.entityRegistrant(b.id)) !== ethers.ZeroAddress) { console.log(`  entity ${b.id}: already recorded, skipping`); continue; }
      const tx = await proxy.backfillRegistration(b.id, b.registrant, b.shares, txOverrides());
      const r = await tx.wait();
      if (!r || r.status !== 1) throw new Error(`backfillRegistration(${b.id}) failed`);
      console.log(`  entity ${b.id}: registrant=${await proxy.entityRegistrant(b.id)} shares=${await proxy.entityRegistrationShares(b.id)}`);
    }
  } else {
    console.log(`\nNo BACKFILL_REGISTRATIONS given. Every entity created before this upgrade has no floor record;`);
    console.log(`backfill each with its creation seed (first Staked event by the owner), e.g. "1:0xOwner:100000000000000000000".`);
  }
};

export default func;
func.tags = ["VanaPoolStakingUpgrade"];
