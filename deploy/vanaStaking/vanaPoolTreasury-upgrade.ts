import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const implementationContractName = "VanaPoolTreasuryImplementation";

/**
 * Upgrades the VanaPoolTreasury proxy to v2 (narrow SPENDER_ROLE).
 *
 * CRITICAL: v2 gates transferVana on SPENDER_ROLE, which nobody holds on a v1
 * deployment, so a plain upgradeTo would make EVERY unstake revert until the
 * role is granted. The upgrade therefore happens via upgradeToAndCall with
 * updateVanaPool(staking) as the payload: in the same transaction the staking
 * contract is granted SPENDER_ROLE (updateVanaPool re-pointing to the same
 * address revokes a role nobody holds, then grants it). Then
 * updateVanaPoolEntity(entity) grants the entity its spend right
 * (claimCommission / sweepUnallocatedRewards pay out through it).
 *
 * Env:
 *   VANA_POOL_TREASURY_PROXY_ADDRESS (required)  the LIVE treasury (staking.vanaPoolTreasury())
 *   VANA_POOL_STAKING_PROXY_ADDRESS  (required)
 *   VANA_POOL_ENTITY_PROXY_ADDRESS   (required)
 *   REVOKE_STAKING_ADMIN=true        also revoke the v1-era DEFAULT_ADMIN_ROLE from the staking contract
 *   DEPLOY_ONLY=true                 deploy the implementation only; print the multisig calls
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress = process.env.VANA_POOL_TREASURY_PROXY_ADDRESS;
  const stakingAddress = process.env.VANA_POOL_STAKING_PROXY_ADDRESS;
  const entityAddress = process.env.VANA_POOL_ENTITY_PROXY_ADDRESS;
  if (!proxyAddress || !stakingAddress || !entityAddress) {
    throw new Error("VANA_POOL_TREASURY_PROXY_ADDRESS, VANA_POOL_STAKING_PROXY_ADDRESS and VANA_POOL_ENTITY_PROXY_ADDRESS are required");
  }

  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);
  const liveVanaPool = await proxy.vanaPool();
  if (liveVanaPool.toLowerCase() !== stakingAddress.toLowerCase()) {
    throw new Error(`treasury.vanaPool() is ${liveVanaPool}, not the given staking address — wrong treasury?`);
  }
  console.log(`Treasury ${proxyAddress}: version ${await proxy.version()}, vanaPool ${liveVanaPool}, balance ${ethers.formatEther(await ethers.provider.getBalance(proxyAddress))} VANA`);

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

  const grantStakingData = proxy.interface.encodeFunctionData("updateVanaPool", [stakingAddress]);

  if (process.env.DEPLOY_ONLY === "true") {
    console.log(`\nDEPLOY_ONLY=true — skipping upgrade. Multisig calls, in order (1 is atomic and MUST carry the payload):`);
    console.log(`  1. ${proxyAddress}.upgradeToAndCall(${implementationDeploy.address}, ${grantStakingData})`);
    console.log(`  2. ${proxyAddress}.updateVanaPoolEntity(${entityAddress})`);
    if (process.env.REVOKE_STAKING_ADMIN === "true") console.log(`  3. ${proxyAddress}.revokeRole(DEFAULT_ADMIN_ROLE, ${stakingAddress})`);
    return;
  }

  console.log(`\n********** Step 2: upgradeToAndCall(impl, updateVanaPool(staking)) — atomic SPENDER grant **********`);
  const upTx = await proxy.upgradeToAndCall(implementationDeploy.address, grantStakingData, txOverrides());
  const upR = await upTx.wait();
  if (!upR || upR.status !== 1) throw new Error("Upgrade transaction failed");
  const SPENDER_ROLE = await proxy.SPENDER_ROLE();
  if (!(await proxy.hasRole(SPENDER_ROLE, stakingAddress))) throw new Error("staking did not receive SPENDER_ROLE");
  console.log(`Upgrade confirmed. version = ${await proxy.version()}; staking holds SPENDER_ROLE.`);

  console.log(`\n********** Step 3: updateVanaPoolEntity(entity) **********`);
  const entTx = await proxy.updateVanaPoolEntity(entityAddress, txOverrides());
  const entR = await entTx.wait();
  if (!entR || entR.status !== 1) throw new Error("updateVanaPoolEntity failed");
  console.log(`entity holds SPENDER_ROLE: ${await proxy.hasRole(SPENDER_ROLE, entityAddress)}`);

  if (process.env.REVOKE_STAKING_ADMIN === "true") {
    console.log(`\n********** Step 4: revoke v1-era DEFAULT_ADMIN_ROLE from staking **********`);
    const rvTx = await proxy.revokeRole(ethers.ZeroHash, stakingAddress, txOverrides());
    await rvTx.wait();
    console.log(`staking DEFAULT_ADMIN_ROLE: ${await proxy.hasRole(ethers.ZeroHash, stakingAddress)}`);
  } else {
    console.log(`\nNote: the staking contract still holds the v1-era DEFAULT_ADMIN_ROLE on the treasury; v2's design`);
    console.log(`gives it only SPENDER_ROLE. Re-run with REVOKE_STAKING_ADMIN=true (or revoke via multisig) to narrow it.`);
  }
};

export default func;
func.tags = ["VanaPoolTreasuryUpgrade"];
