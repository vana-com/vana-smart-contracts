import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deterministicDeployProxy, verifyProxy } from "../helpers";

/**
 * Deploys the RewardSplitter (implementation + UUPS proxy) and WIRES it into the
 * VanaPoolEntity: the splitter pays delegator-earned rewards through
 * addStakerRewards, which is gated by REWARD_SPLITTER_ROLE. That role cannot be
 * granted in VanaPoolEntity.initialize (the splitter is deployed after the
 * entity), so the wiring is a first-class setter, updateRewardSplitter, and this
 * script performs it. Without this step every addStakerRewards call reverts
 * (NM-1052 [High] follow-up: "REWARD_SPLITTER_ROLE is not granted").
 *
 * The splitter needs no treasury role: addStakerRewards forwards the value to
 * the treasury itself; the splitter only ever pays INTO the entity.
 *
 * Env:
 *   VANA_POOL_ENTITY_PROXY_ADDRESS  (required) the VanaPoolEntity proxy
 *   OWNER_ADDRESS                   (optional) splitter admin/maintainer/distributor; defaults to deployer
 *   CREATE2_SALT                    (optional) deterministic proxy salt
 *   REWARD_VESTING_DURATION         (optional) seconds; sets updateRewardVestingDuration (distribute
 *                                   reverts VestingDurationNotSet while it is 0)
 *   DISTRIBUTOR_ADDRESS             (optional) grants DISTRIBUTOR_ROLE to a dedicated distributor
 */
const implementationContractName = "RewardSplitterImplementation";
const proxyContractName = "RewardSplitterProxy";
const proxyContractPath = "contracts/vanaStaking/rewardSplitter/RewardSplitterProxy.sol:RewardSplitterProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const entityProxyAddress = process.env.VANA_POOL_ENTITY_PROXY_ADDRESS;
  if (!entityProxyAddress) {
    throw new Error("VANA_POOL_ENTITY_PROXY_ADDRESS environment variable is required");
  }
  const ownerAddress = process.env.OWNER_ADDRESS || deployer.address;
  const salt = process.env.CREATE2_SALT || "RewardSplitterProxySalt";

  console.log(``);
  console.log(`**************************************************************`);
  console.log(`********** Deploy ${proxyContractName} + ${implementationContractName} **********`);
  console.log(`VanaPoolEntity proxy: ${entityProxyAddress}`);
  console.log(`Splitter owner:       ${ownerAddress}`);

  // Step 1: implementation + proxy, initialized with (owner, entity)
  const proxyDeploy = await deterministicDeployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [ownerAddress, entityProxyAddress],
    salt,
  );
  console.log(`${proxyContractName} deployed at:          ${proxyDeploy.proxyAddress}`);
  console.log(`${implementationContractName} at: ${proxyDeploy.implementationAddress}`);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  // Step 2: wire REWARD_SPLITTER_ROLE on the entity (revokes any previous splitter)
  console.log(`\n********** Step 2: wire the splitter into VanaPoolEntity **********`);
  const entity = await ethers.getContractAt("VanaPoolEntityImplementation", entityProxyAddress);
  const maintainerRole = await entity.MAINTAINER_ROLE();
  const deployerIsMaintainer = await entity.hasRole(maintainerRole, deployer.address);

  if (deployerIsMaintainer) {
    const tx = await entity.updateRewardSplitter(proxyDeploy.proxyAddress);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("updateRewardSplitter transaction failed");
    }
    console.log(`Wired: entity.rewardSplitter() = ${await entity.rewardSplitter()}`);
  } else {
    console.log(`Deployer lacks MAINTAINER_ROLE on the entity; wire it from the maintainer / multisig:`);
    console.log(`  VanaPoolEntity(${entityProxyAddress}).updateRewardSplitter(${proxyDeploy.proxyAddress})`);
  }

  // Step 3: splitter configuration (roles on the splitter itself)
  console.log(`\n********** Step 3: configure the splitter **********`);
  const splitter = await ethers.getContractAt(implementationContractName, proxyDeploy.proxyAddress);
  const splitterMaintainer = await splitter.hasRole(await splitter.MAINTAINER_ROLE(), deployer.address);
  const splitterAdmin = await splitter.hasRole(ethers.ZeroHash, deployer.address);

  const vesting = process.env.REWARD_VESTING_DURATION;
  if (vesting) {
    if (splitterMaintainer) {
      const tx = await splitter.updateRewardVestingDuration(Number(vesting));
      await tx.wait();
      console.log(`rewardVestingDuration = ${await splitter.rewardVestingDuration()} s`);
    } else {
      console.log(`Deployer lacks the splitter's MAINTAINER_ROLE; from ${ownerAddress}:`);
      console.log(`  RewardSplitter(${proxyDeploy.proxyAddress}).updateRewardVestingDuration(${vesting})`);
    }
  } else {
    console.log(`REWARD_VESTING_DURATION not set: distribute() will revert VestingDurationNotSet until it is.`);
  }

  const distributor = process.env.DISTRIBUTOR_ADDRESS;
  if (distributor) {
    const DISTRIBUTOR_ROLE = await splitter.DISTRIBUTOR_ROLE();
    if (splitterAdmin) {
      const tx = await splitter.grantRole(DISTRIBUTOR_ROLE, distributor);
      await tx.wait();
      console.log(`DISTRIBUTOR_ROLE granted to ${distributor}: ${await splitter.hasRole(DISTRIBUTOR_ROLE, distributor)}`);
    } else {
      console.log(`Deployer lacks the splitter's DEFAULT_ADMIN_ROLE; from ${ownerAddress}:`);
      console.log(`  RewardSplitter(${proxyDeploy.proxyAddress}).grantRole(DISTRIBUTOR_ROLE, ${distributor})`);
    }
  }

  // Final state
  const REWARD_SPLITTER_ROLE = await entity.REWARD_SPLITTER_ROLE();
  console.log(`\nFinal state:`);
  console.log(`  entity.rewardSplitter()                      = ${await entity.rewardSplitter()}`);
  console.log(`  entity.hasRole(REWARD_SPLITTER_ROLE, splitter) = ${await entity.hasRole(REWARD_SPLITTER_ROLE, proxyDeploy.proxyAddress)}`);
  console.log(`  splitter.rewardVestingDuration()             = ${await splitter.rewardVestingDuration()} s`);
  console.log(`  splitter.payEntityCommission()               = ${await splitter.payEntityCommission()}`);
  console.log(`  splitter admin/maintainer/distributor        = ${ownerAddress}${distributor ? ` (+ distributor ${distributor})` : ""}`);
  console.log(`\nRemaining: fund the splitter with VANA (plain transfer to ${proxyDeploy.proxyAddress}). The first`);
  console.log(`distribute() round only records baselines and pays nothing; the second round pays.`);
};

export default func;
func.tags = ["RewardSplitterDeploy"];
