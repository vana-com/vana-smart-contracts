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
 * Env:
 *   VANA_POOL_ENTITY_PROXY_ADDRESS  (required) the VanaPoolEntity proxy
 *   OWNER_ADDRESS                   (optional) splitter admin; defaults to deployer
 *   CREATE2_SALT                    (optional) deterministic proxy salt
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

  console.log(`\nNext steps before the first distribution:`);
  console.log(`  - RewardSplitter.updateRewardVestingDuration(seconds)  (distribute reverts VestingDurationNotSet while 0)`);
  console.log(`  - fund the splitter (plain VANA transfer) and grant DISTRIBUTOR_ROLE to the distributor`);
  console.log(`  - confirm entity.hasRole(REWARD_SPLITTER_ROLE, ${proxyDeploy.proxyAddress}) == true`);
};

export default func;
func.tags = ["RewardSplitterDeploy"];
