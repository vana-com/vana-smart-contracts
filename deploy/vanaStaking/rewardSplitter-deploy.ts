import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Deploys the RewardSplitter at the SAME address on every chain and wires it into
 * the VanaPoolEntity.
 *
 * Address parity: a proxy created directly through the CREATE2 factory embeds its
 * initialize(owner, entity) calldata in the creation code, so the owner (testnet
 * EOA vs mainnet multisig) changes the address. Instead, RewardSplitterDeployer --
 * itself CREATE2-deployed with a fixed salt and no constructor args, so it has the
 * same address everywhere -- creates the proxy with EMPTY constructor data and
 * calls initialize atomically. The proxy address then depends only on:
 *   (deployer contract, CREATE2_SALT, VanaPoolEntity address, implementation address)
 * -- none of which depends on who signs or who the owner is. Only a MAINTAINER of the
 * entity may deploy (otherwise anyone could occupy the address with a different
 * owner). Therefore, for the same address on mainnet:
 *   - deploy from the SAME commit (the implementation bytecode/address is part of it),
 *   - use the SAME CREATE2_SALT (the entity address is already identical on both chains),
 *   - sign with ANY maintainer of the entity.
 * Idempotent: if code already exists at the predicted address, creation is skipped.
 *
 * The splitter needs no treasury role (addStakerRewards forwards value to the
 * treasury itself).
 *
 * Env:
 *   VANA_POOL_ENTITY_PROXY_ADDRESS  (required)
 *   OWNER_ADDRESS                   (optional) splitter admin/maintainer/distributor; default signer
 *   CREATE2_SALT                    (optional) default "RewardSplitterProxySalt"
 *   REWARD_VESTING_DURATION         (optional) seconds; distribute reverts VestingDurationNotSet while 0
 *   DISTRIBUTOR_ADDRESS             (optional) grants DISTRIBUTOR_ROLE to a dedicated distributor
 */
const implementationContractName = "RewardSplitterImplementation";
const proxyContractName = "RewardSplitterProxy";
const deployerContractName = "RewardSplitterDeployer";
const DEPLOYER_SALT = "VanaRewardSplitterDeployer"; // fixed on purpose: same deployer address on every chain

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [signer] = await ethers.getSigners();

  const entityProxyAddress = process.env.VANA_POOL_ENTITY_PROXY_ADDRESS;
  if (!entityProxyAddress) throw new Error("VANA_POOL_ENTITY_PROXY_ADDRESS environment variable is required");
  const ownerAddress = process.env.OWNER_ADDRESS || signer.address;
  const salt = process.env.CREATE2_SALT || "RewardSplitterProxySalt";
  const saltHash = ethers.keccak256(ethers.toUtf8Bytes(salt));

  console.log(`\n********** RewardSplitter: deterministic deploy + wiring **********`);
  console.log(`Signer (must be an entity maintainer): ${signer.address}`);
  console.log(`VanaPoolEntity proxy:         ${entityProxyAddress}`);
  console.log(`Splitter owner:               ${ownerAddress}`);

  // Step 1: the deployer contract (CREATE2, fixed salt, no args -> same address everywhere)
  const deployerDeploy = await deployments.deploy(deployerContractName, {
    from: signer.address, args: [], log: true,
    deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(DEPLOYER_SALT)),
  });
  // Step 2: the implementation (CREATE2, no args -> same address for the same bytecode)
  const implDeploy = await deployments.deploy(implementationContractName, {
    from: signer.address, args: [], log: true,
    deterministicDeployment: saltHash,
  });

  // Step 3: predicted proxy address, then create + initialize atomically (if absent)
  const deployerC = await ethers.getContractAt(deployerContractName, deployerDeploy.address);
  const predicted: string = await deployerC.computeAddress(saltHash, implDeploy.address, entityProxyAddress);
  console.log(`\nPredicted proxy address: ${predicted}`);
  console.log(`(same on any chain with this commit's implementation, salt "${salt}" and entity ${entityProxyAddress}, whoever signs)`);

  const entity = await ethers.getContractAt("VanaPoolEntityImplementation", entityProxyAddress);
  const maintainerRole = await entity.MAINTAINER_ROLE();
  if (!(await entity.hasRole(maintainerRole, signer.address))) {
    throw new Error(`signer ${signer.address} is not a MAINTAINER of the entity; RewardSplitterDeployer.deploy would revert NotEntityMaintainer`);
  }

  if ((await ethers.provider.getCode(predicted)) !== "0x") {
    console.log(`Proxy already exists at the predicted address; skipping creation.`);
  } else {
    const tx = await deployerC.deploy(saltHash, implDeploy.address, entityProxyAddress, ownerAddress);
    const r = await tx.wait();
    if (!r || r.status !== 1) throw new Error("RewardSplitterDeployer.deploy failed");
    if ((await ethers.provider.getCode(predicted)) === "0x") throw new Error("proxy did not land at the predicted address");
    console.log(`Proxy created and initialized at ${predicted}`);
  }
  const proxyAddress = predicted;
  const proxyArtifact = await deployments.getArtifact(proxyContractName);
  await deployments.save(proxyContractName, { address: proxyAddress, abi: proxyArtifact.abi, args: [implDeploy.address, "0x"] });

  await verifyContract(deployerDeploy.address, []);
  await verifyContract(implDeploy.address, []);
  await verifyContract(proxyAddress, [implDeploy.address, "0x"]);

  // Step 4: wire REWARD_SPLITTER_ROLE on the entity (revokes any previous splitter)
  console.log(`\n********** Step 4: wire the splitter into VanaPoolEntity **********`);
  if (await entity.hasRole(maintainerRole, signer.address)) {
    if ((await entity.rewardSplitter()).toLowerCase() === proxyAddress.toLowerCase()) {
      console.log(`Already wired.`);
    } else {
      const tx = await entity.updateRewardSplitter(proxyAddress);
      const r = await tx.wait();
      if (!r || r.status !== 1) throw new Error("updateRewardSplitter transaction failed");
      console.log(`Wired: entity.rewardSplitter() = ${await entity.rewardSplitter()}`);
    }
  } else {
    console.log(`Signer lacks MAINTAINER_ROLE on the entity; wire it from the maintainer / multisig:`);
    console.log(`  VanaPoolEntity(${entityProxyAddress}).updateRewardSplitter(${proxyAddress})`);
  }

  // Step 5: splitter configuration (roles on the splitter itself)
  console.log(`\n********** Step 5: configure the splitter **********`);
  const splitter = await ethers.getContractAt(implementationContractName, proxyAddress);
  const splitterMaintainer = await splitter.hasRole(await splitter.MAINTAINER_ROLE(), signer.address);
  const splitterAdmin = await splitter.hasRole(ethers.ZeroHash, signer.address);

  const vesting = process.env.REWARD_VESTING_DURATION;
  if (vesting) {
    if (Number(await splitter.rewardVestingDuration()) === Number(vesting)) {
      console.log(`rewardVestingDuration already ${vesting} s`);
    } else if (splitterMaintainer) {
      const tx = await splitter.updateRewardVestingDuration(Number(vesting));
      await tx.wait();
      console.log(`rewardVestingDuration = ${await splitter.rewardVestingDuration()} s`);
    } else {
      console.log(`Signer lacks the splitter's MAINTAINER_ROLE; from ${ownerAddress}:`);
      console.log(`  RewardSplitter(${proxyAddress}).updateRewardVestingDuration(${vesting})`);
    }
  } else {
    console.log(`REWARD_VESTING_DURATION not set: distribute() will revert VestingDurationNotSet until it is.`);
  }

  const distributor = process.env.DISTRIBUTOR_ADDRESS;
  if (distributor) {
    const DISTRIBUTOR_ROLE = await splitter.DISTRIBUTOR_ROLE();
    if (await splitter.hasRole(DISTRIBUTOR_ROLE, distributor)) {
      console.log(`DISTRIBUTOR_ROLE already granted to ${distributor}`);
    } else if (splitterAdmin) {
      const tx = await splitter.grantRole(DISTRIBUTOR_ROLE, distributor);
      await tx.wait();
      console.log(`DISTRIBUTOR_ROLE granted to ${distributor}`);
    } else {
      console.log(`Signer lacks the splitter's DEFAULT_ADMIN_ROLE; from ${ownerAddress}:`);
      console.log(`  RewardSplitter(${proxyAddress}).grantRole(DISTRIBUTOR_ROLE, ${distributor})`);
    }
  }

  const REWARD_SPLITTER_ROLE = await entity.REWARD_SPLITTER_ROLE();
  console.log(`\nFinal state:`);
  console.log(`  deployer contract                            = ${deployerDeploy.address}`);
  console.log(`  implementation                               = ${implDeploy.address}`);
  console.log(`  proxy                                        = ${proxyAddress}`);
  console.log(`  entity.rewardSplitter()                      = ${await entity.rewardSplitter()}`);
  console.log(`  entity.hasRole(REWARD_SPLITTER_ROLE, proxy)  = ${await entity.hasRole(REWARD_SPLITTER_ROLE, proxyAddress)}`);
  console.log(`  splitter.rewardVestingDuration()             = ${await splitter.rewardVestingDuration()} s`);
  console.log(`  splitter.payEntityCommission()               = ${await splitter.payEntityCommission()}`);
  console.log(`\nRemaining: fund the splitter (plain VANA transfer to ${proxyAddress}). The first distribute() round`);
  console.log(`only records baselines and pays nothing; the second round pays.`);
};

export default func;
func.tags = ["RewardSplitterDeploy"];
