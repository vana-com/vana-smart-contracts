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
 * (claimCommission / sweepUnallocatedRewards pay out through it). Finally,
 * once BOTH spender grants are confirmed on-chain, the v1-era
 * DEFAULT_ADMIN_ROLE is revoked from the staking contract: v2's design gives
 * it only SPENDER_ROLE (a spender must not be able to upgrade or pause the
 * treasury that custodies all principal).
 *
 * Rollback note: v1 gates transferVana on DEFAULT_ADMIN_ROLE, so a rollback to
 * the v1 implementation must be preceded by grantRole(DEFAULT_ADMIN_ROLE,
 * staking) from the admin, or every unstake reverts.
 *
 * Env:
 *   VANA_POOL_TREASURY_PROXY_ADDRESS (required)  the LIVE treasury (staking.vanaPoolTreasury())
 *   VANA_POOL_STAKING_PROXY_ADDRESS  (required)
 *   VANA_POOL_ENTITY_PROXY_ADDRESS   (required)
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
    console.log(`  3. ${proxyAddress}.revokeRole(0x${"0".repeat(64)}, ${stakingAddress})   // DEFAULT_ADMIN_ROLE; only after 1 and 2 are confirmed`);
    return;
  }

  console.log(`\n********** Step 2: upgradeToAndCall(impl, updateVanaPool(staking)) — atomic SPENDER grant **********`);
  const upTx = await proxy.upgradeToAndCall(implementationDeploy.address, grantStakingData, txOverrides());
  const upR = await upTx.wait();
  if (!upR || upR.status !== 1) throw new Error("Upgrade transaction failed");
  const SPENDER_ROLE = await proxy.SPENDER_ROLE();
  if (!(await proxy.hasRole(SPENDER_ROLE, stakingAddress))) throw new Error("staking did not receive SPENDER_ROLE");
  console.log(`Upgrade confirmed. version = ${await proxy.version()}; staking holds SPENDER_ROLE.`);

  console.log(`\n********** Step 3: updateVanaPoolEntity(entity) — SPENDER grant to the entity **********`);
  const entTx = await proxy.updateVanaPoolEntity(entityAddress, txOverrides());
  const entR = await entTx.wait();
  if (!entR || entR.status !== 1) throw new Error("updateVanaPoolEntity failed");
  if (!(await proxy.hasRole(SPENDER_ROLE, entityAddress))) throw new Error("entity did not receive SPENDER_ROLE");
  console.log(`entity holds SPENDER_ROLE.`);

  // Both spender grants are confirmed on-chain; only now is it safe to narrow
  // the staking contract to SPENDER_ROLE alone.
  console.log(`\n********** Step 4: revoke v1-era DEFAULT_ADMIN_ROLE from staking **********`);
  const rvTx = await proxy.revokeRole(ethers.ZeroHash, stakingAddress, txOverrides());
  const rvR = await rvTx.wait();
  if (!rvR || rvR.status !== 1) throw new Error("revokeRole failed");
  if (await proxy.hasRole(ethers.ZeroHash, stakingAddress)) throw new Error("staking still holds DEFAULT_ADMIN_ROLE");
  console.log(`staking no longer holds DEFAULT_ADMIN_ROLE; it holds SPENDER_ROLE only.`);

  console.log(`\nFinal roles on ${proxyAddress}:`);
  console.log(`  SPENDER_ROLE       staking=${await proxy.hasRole(SPENDER_ROLE, stakingAddress)} entity=${await proxy.hasRole(SPENDER_ROLE, entityAddress)}`);
  console.log(`  DEFAULT_ADMIN_ROLE staking=${await proxy.hasRole(ethers.ZeroHash, stakingAddress)} deployer=${await proxy.hasRole(ethers.ZeroHash, deployer.address)}`);
  console.log(`Rollback to v1 would require grantRole(DEFAULT_ADMIN_ROLE, ${stakingAddress}) first (v1 gates transferVana on it).`);
};

export default func;
func.tags = ["VanaPoolTreasuryUpgrade"];
