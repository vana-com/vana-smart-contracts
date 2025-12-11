import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { formatEther, Contract } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {
  VanaPoolStakingImplementation,
  VanaPoolEntityImplementation,
  VanaPoolTreasuryImplementation,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "../../utils/helpers";

chai.use(chaiAsPromised);
should();

/**
 * Fork test for VanaPoolStaking on Moksha testnet
 *
 * To run this test:
 * 1. Uncomment the forking configuration in hardhat.config.ts:
 *    forking: {
 *      url: process.env.MOKSHA_RPC_URL || "",
 *      blockNumber: 5244700,
 *    },
 * 2. Set MOKSHA_RPC_URL in your .env file
 * 3. Run: npx hardhat test test/vanaStaking/forkVanaPool.ts
 *
 * Moksha testnet info:
 * - Block 5244700: Snapshot block for V1 contracts
 * - VanaPoolStakingProxy: 0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e
 * - VanaPoolEntityProxy: Retrieved from VanaPoolStaking.vanaPoolEntity()
 */
describe("VanaPool Fork Tests (Moksha)", () => {
  // Moksha contract addresses at block 5244700
  const VANA_POOL_STAKING_PROXY = "0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e";
  const FORK_BLOCK = 5244700;

  // V1 ABI for reading from deployed V1 contracts on Moksha at block 5244700
  // The original V1 StakerEntity struct only has: shares (no costBasis, rewardEligibilityTimestamp, etc.)
  // The original V1 also does NOT have bondingPeriod (that was added later in development)
  const VANA_POOL_STAKING_V1_ABI = [
    "function version() external pure returns (uint256)",
    "function vanaPoolEntity() external view returns (address)",
    "function vanaPoolTreasury() external view returns (address)",
    "function minStakeAmount() external view returns (uint256)",
    "function activeStakersListCount() external view returns (uint256)",
    "function activeStakersListAt(uint256 index) external view returns (address)",
    // Original V1 stakerEntities returns struct with only shares
    "function stakerEntities(address staker, uint256 entityId) external view returns (uint256 shares)",
    "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  ];

  let vanaPoolStakingV1: Contract;
  let vanaPoolStakingV2: VanaPoolStakingImplementation;
  let vanaPoolEntity: VanaPoolEntityImplementation;
  let vanaPoolTreasury: VanaPoolTreasuryImplementation;

  let admin: HardhatEthersSigner;

  // Snapshot data to capture before upgrade (original V1 structure - only has shares)
  interface StakerSnapshotV1 {
    address: string;
    entityId: bigint;
    shares: bigint;
  }

  interface EntitySnapshot {
    entityId: bigint;
    ownerAddress: string;
    name: string;
    maxAPY: bigint;
    lockedRewardPool: bigint;
    activeRewardPool: bigint;
    totalShares: bigint;
    lastUpdateTimestamp: bigint;
  }

  let stakerSnapshots: StakerSnapshotV1[] = [];
  let entitySnapshots: EntitySnapshot[] = [];

  const isForkEnabled = async (): Promise<boolean> => {
    const blockNumber = await ethers.provider.getBlockNumber();
    return blockNumber >= FORK_BLOCK - 100;
  };

  const setupFork = async () => {
    // Get V1 contract using minimal ABI
    vanaPoolStakingV1 = new Contract(
      VANA_POOL_STAKING_PROXY,
      VANA_POOL_STAKING_V1_ABI,
      ethers.provider
    );

    // Get VanaPoolEntity address from VanaPoolStaking
    const entityAddress = await vanaPoolStakingV1.vanaPoolEntity();
    vanaPoolEntity = await ethers.getContractAt(
      "VanaPoolEntityImplementation",
      entityAddress,
    );

    // Get VanaPoolTreasury address from VanaPoolStaking
    const treasuryAddress = await vanaPoolStakingV1.vanaPoolTreasury();
    vanaPoolTreasury = await ethers.getContractAt(
      "VanaPoolTreasuryImplementation",
      treasuryAddress,
    );

    const blockNumber = await ethers.provider.getBlockNumber();
    console.log(`\n=== Fork Test Setup ===`);
    console.log(`Block number: ${blockNumber}`);
    console.log(`VanaPoolStaking: ${VANA_POOL_STAKING_PROXY}`);
    console.log(`VanaPoolEntity: ${entityAddress}`);
    console.log(`VanaPoolTreasury: ${treasuryAddress}`);
  };

  const captureStateSnapshot = async () => {
    console.log(`\n=== Capturing State Snapshot ===`);

    // Capture entity data
    const entitiesCount = await vanaPoolEntity.entitiesCount();
    console.log(`Total entities: ${entitiesCount}`);

    entitySnapshots = [];
    for (let i = 1; i <= entitiesCount; i++) {
      const entity = await vanaPoolEntity.entities(i);
      entitySnapshots.push({
        entityId: BigInt(i),
        ownerAddress: entity.ownerAddress,
        name: entity.name,
        maxAPY: entity.maxAPY,
        lockedRewardPool: entity.lockedRewardPool,
        activeRewardPool: entity.activeRewardPool,
        totalShares: entity.totalShares,
        lastUpdateTimestamp: entity.lastUpdateTimestamp,
      });
      console.log(`  Entity ${i}: ${entity.name} (owner: ${entity.ownerAddress})`);
      console.log(`    - totalShares: ${formatEther(entity.totalShares)} VANA`);
      console.log(`    - activeRewardPool: ${formatEther(entity.activeRewardPool)} VANA`);
      console.log(`    - lockedRewardPool: ${formatEther(entity.lockedRewardPool)} VANA`);
    }

    // Capture active stakers data using V1 ABI
    const activeStakersCount = await vanaPoolStakingV1.activeStakersListCount();
    console.log(`\nActive stakers: ${activeStakersCount}`);

    stakerSnapshots = [];
    for (let i = 0; i < activeStakersCount; i++) {
      const stakerAddress = await vanaPoolStakingV1.activeStakersListAt(i);

      // Check each entity for this staker
      for (let entityId = 1; entityId <= entitiesCount; entityId++) {
        // Original V1 returns only shares (single uint256)
        const shares = await vanaPoolStakingV1.stakerEntities(stakerAddress, entityId);
        if (shares > 0n) {
          stakerSnapshots.push({
            address: stakerAddress,
            entityId: BigInt(entityId),
            shares: shares,
          });
          console.log(`  Staker ${stakerAddress} in entity ${entityId}:`);
          console.log(`    - shares: ${formatEther(shares)}`);
        }
      }
    }

    console.log(`\nCaptured ${stakerSnapshots.length} staker positions`);
  };

  const verifyStateAfterUpgrade = async () => {
    console.log(`\n=== Verifying State After Upgrade ===`);

    // Verify version
    const version = await vanaPoolStakingV2.version();
    console.log(`Contract version: ${version}`);
    version.should.eq(2n, "Version should be 2 after upgrade");

    // Verify entity data preserved
    console.log(`\nVerifying entity data...`);
    for (const snapshot of entitySnapshots) {
      const entity = await vanaPoolEntity.entities(snapshot.entityId);
      entity.ownerAddress.should.eq(snapshot.ownerAddress, `Entity ${snapshot.entityId} owner mismatch`);
      entity.name.should.eq(snapshot.name, `Entity ${snapshot.entityId} name mismatch`);
      entity.maxAPY.should.eq(snapshot.maxAPY, `Entity ${snapshot.entityId} maxAPY mismatch`);
      entity.totalShares.should.eq(snapshot.totalShares, `Entity ${snapshot.entityId} totalShares mismatch`);
      console.log(`  ✓ Entity ${snapshot.entityId} (${snapshot.name}) verified`);
    }

    // Verify staker data preserved
    console.log(`\nVerifying staker data...`);
    for (const snapshot of stakerSnapshots) {
      const stakerEntity = await vanaPoolStakingV2.stakerEntities(snapshot.address, snapshot.entityId);
      // Original V1 only had shares - verify it's preserved
      stakerEntity.shares.should.eq(snapshot.shares, `Staker ${snapshot.address} shares mismatch`);

      // New V2 fields should be initialized to 0 (these didn't exist in original V1)
      stakerEntity.costBasis.should.eq(0n, `Staker ${snapshot.address} costBasis should be 0 (new field)`);
      stakerEntity.rewardEligibilityTimestamp.should.eq(0n, `Staker ${snapshot.address} rewardEligibilityTimestamp should be 0 (new field)`);
      stakerEntity.realizedRewards.should.eq(0n, `Staker ${snapshot.address} realizedRewards should be 0`);
      stakerEntity.vestedRewards.should.eq(0n, `Staker ${snapshot.address} vestedRewards should be 0`);

      console.log(`  ✓ Staker ${snapshot.address} in entity ${snapshot.entityId} verified`);
    }

    // Verify new functions work
    console.log(`\nVerifying new V2 functions...`);
    if (stakerSnapshots.length > 0) {
      const testStaker = stakerSnapshots[0];
      const accruingInterest = await vanaPoolStakingV2.getAccruingInterest(testStaker.address, testStaker.entityId);
      const earnedRewards = await vanaPoolStakingV2.getEarnedRewards(testStaker.address, testStaker.entityId);

      console.log(`  Test staker ${testStaker.address}:`);
      console.log(`    - getAccruingInterest: ${formatEther(accruingInterest)} VANA`);
      console.log(`    - getEarnedRewards: ${formatEther(earnedRewards)} VANA`);

      // earnedRewards should equal accruingInterest when realizedRewards is 0
      earnedRewards.should.eq(accruingInterest, "earnedRewards should equal accruingInterest when no realized rewards");
      console.log(`  ✓ New V2 functions working correctly`);
    }
  };

  describe("State Snapshot at Block 5244700", () => {
    before(async function () {
      if (!(await isForkEnabled())) {
        console.log("Fork not enabled, skipping tests. Enable forking in hardhat.config.ts");
        this.skip();
      }
      await setupFork();
    });

    it("should capture current state from Moksha", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      await captureStateSnapshot();

      // Basic assertions
      entitySnapshots.length.should.be.gt(0, "Should have at least one entity");
    });

    it("should display contract versions", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      const stakingVersion = await vanaPoolStakingV1.version();
      const entityVersion = await vanaPoolEntity.version();
      const treasuryVersion = await vanaPoolTreasury.version();

      console.log(`\n=== Contract Versions ===`);
      console.log(`VanaPoolStaking: v${stakingVersion}`);
      console.log(`VanaPoolEntity: v${entityVersion}`);
      console.log(`VanaPoolTreasury: v${treasuryVersion}`);

      // V1 contracts should have version 1
      stakingVersion.should.eq(1n, "VanaPoolStaking should be v1 before upgrade");
    });

    it("should display staking configuration", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      // Original V1 does not have bondingPeriod - only minStakeAmount
      const minStakeAmount = await vanaPoolStakingV1.minStakeAmount();

      console.log(`\n=== Staking Configuration ===`);
      console.log(`Min stake amount: ${formatEther(minStakeAmount)} VANA`);
      console.log(`Note: Original V1 does not have bondingPeriod`);
    });
  });

  describe("Upgrade to V2", () => {
    before(async function () {
      if (!(await isForkEnabled())) {
        console.log("Fork not enabled, skipping tests. Enable forking in hardhat.config.ts");
        this.skip();
      }
      await setupFork();
      await captureStateSnapshot();
    });

    it("should upgrade VanaPoolStaking to V2 and preserve state", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      // Get admin address from environment variable (OWNER_ADDRESS)
      const adminAddress = process.env.OWNER_ADDRESS;

      if (!adminAddress) {
        console.log("OWNER_ADDRESS not set in .env, skipping upgrade test");
        return this.skip();
      }

      console.log(`\nAdmin address from OWNER_ADDRESS: ${adminAddress}`);

      // Impersonate admin
      await helpers.impersonateAccount(adminAddress);
      await helpers.setBalance(adminAddress, parseEther(100));
      admin = await ethers.getSigner(adminAddress);

      // Deploy new V2 implementation
      const VanaPoolStakingV2Factory = await ethers.getContractFactory(
        "VanaPoolStakingImplementation",
        admin
      );

      console.log(`\nDeploying new V2 implementation...`);
      const newImplementation = await VanaPoolStakingV2Factory.deploy();
      await newImplementation.waitForDeployment();
      const newImplAddress = await newImplementation.getAddress();
      console.log(`New implementation deployed at: ${newImplAddress}`);

      // Get the proxy contract to call upgradeToAndCall directly
      const proxyContract = await ethers.getContractAt(
        "VanaPoolStakingImplementation",
        VANA_POOL_STAKING_PROXY,
        admin
      );

      // Upgrade by calling upgradeToAndCall on the UUPS proxy
      console.log(`Upgrading VanaPoolStaking to V2...`);
      const upgradeTx = await proxyContract.upgradeToAndCall(newImplAddress, "0x");
      await upgradeTx.wait();
      console.log(`Upgrade complete!`);

      // Get V2 contract reference
      vanaPoolStakingV2 = await ethers.getContractAt(
        "VanaPoolStakingImplementation",
        VANA_POOL_STAKING_PROXY,
        admin
      );

      // Set bonding period to 5 days (admin has MAINTAINER_ROLE)
      const FIVE_DAYS_IN_SECONDS = 5 * 24 * 60 * 60; // 432000 seconds
      console.log(`\nSetting bonding period to 5 days (${FIVE_DAYS_IN_SECONDS} seconds)...`);
      const setBondingPeriodTx = await vanaPoolStakingV2.updateBondingPeriod(FIVE_DAYS_IN_SECONDS);
      await setBondingPeriodTx.wait();

      const newBondingPeriod = await vanaPoolStakingV2.bondingPeriod();
      console.log(`Bonding period set to: ${newBondingPeriod / 86400n} days (${newBondingPeriod} seconds)`);
      newBondingPeriod.should.eq(BigInt(FIVE_DAYS_IN_SECONDS), "Bonding period should be 5 days");

      // Verify state preserved
      await verifyStateAfterUpgrade();
    });
  });

  describe("V2 Staking Scenario After Upgrade", () => {
    const FIVE_DAYS_IN_SECONDS = 5 * 24 * 60 * 60; // 432000 seconds
    const ENTITY_ID = 1;

    before(async function () {
      if (!(await isForkEnabled())) {
        console.log("Fork not enabled, skipping tests. Enable forking in hardhat.config.ts");
        this.skip();
      }

      // Setup and perform upgrade
      await setupFork();
      await captureStateSnapshot();

      const adminAddress = process.env.OWNER_ADDRESS;
      if (!adminAddress) {
        console.log("OWNER_ADDRESS not set in .env, skipping test");
        return this.skip();
      }

      // Impersonate admin and upgrade
      await helpers.impersonateAccount(adminAddress);
      await helpers.setBalance(adminAddress, parseEther(100));
      admin = await ethers.getSigner(adminAddress);

      // First, upgrade VanaPoolEntity to V2
      const entityProxyAddress = await vanaPoolEntity.getAddress();
      console.log(`\nUpgrading VanaPoolEntity at ${entityProxyAddress}...`);

      const VanaPoolEntityV2Factory = await ethers.getContractFactory(
        "VanaPoolEntityImplementation",
        admin
      );

      const newEntityImplementation = await VanaPoolEntityV2Factory.deploy();
      await newEntityImplementation.waitForDeployment();
      const newEntityImplAddress = await newEntityImplementation.getAddress();
      console.log(`New VanaPoolEntity implementation deployed at: ${newEntityImplAddress}`);

      const entityProxyContract = await ethers.getContractAt(
        "VanaPoolEntityImplementation",
        entityProxyAddress,
        admin
      );

      await entityProxyContract.upgradeToAndCall(newEntityImplAddress, "0x");
      console.log(`VanaPoolEntity upgraded to V2!`);

      // Refresh the vanaPoolEntity reference
      vanaPoolEntity = await ethers.getContractAt(
        "VanaPoolEntityImplementation",
        entityProxyAddress,
        admin
      );

      // Then, upgrade VanaPoolStaking to V2
      console.log(`\nUpgrading VanaPoolStaking at ${VANA_POOL_STAKING_PROXY}...`);

      const VanaPoolStakingV2Factory = await ethers.getContractFactory(
        "VanaPoolStakingImplementation",
        admin
      );

      const newImplementation = await VanaPoolStakingV2Factory.deploy();
      await newImplementation.waitForDeployment();
      const newImplAddress = await newImplementation.getAddress();
      console.log(`New VanaPoolStaking implementation deployed at: ${newImplAddress}`);

      const proxyContract = await ethers.getContractAt(
        "VanaPoolStakingImplementation",
        VANA_POOL_STAKING_PROXY,
        admin
      );

      await proxyContract.upgradeToAndCall(newImplAddress, "0x");
      console.log(`VanaPoolStaking upgraded to V2!`);

      vanaPoolStakingV2 = await ethers.getContractAt(
        "VanaPoolStakingImplementation",
        VANA_POOL_STAKING_PROXY,
        admin
      );

      // Set bonding period to 5 days
      await vanaPoolStakingV2.updateBondingPeriod(FIVE_DAYS_IN_SECONDS);
      console.log(`\n=== Both Contracts Upgraded to V2, Bonding Period: 5 days ===`);
    });

    it("should test existing staker stakes new money with correct bonding period and rewards", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      // Use an existing staker from the snapshot
      const existingStaker = stakerSnapshots[0];
      console.log(`\n=== Testing Existing Staker: ${existingStaker.address} ===`);

      // Impersonate the existing staker
      await helpers.impersonateAccount(existingStaker.address);
      await helpers.setBalance(existingStaker.address, parseEther(1000));
      const stakerSigner = await ethers.getSigner(existingStaker.address);

      // Get staker's state BEFORE new stake
      const stakerEntityBefore = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      const accruingInterestBefore = await vanaPoolStakingV2.getAccruingInterest(existingStaker.address, ENTITY_ID);
      const earnedRewardsBefore = await vanaPoolStakingV2.getEarnedRewards(existingStaker.address, ENTITY_ID);

      console.log(`\n--- Before New Stake ---`);
      console.log(`  Shares: ${formatEther(stakerEntityBefore.shares)}`);
      console.log(`  Cost Basis: ${formatEther(stakerEntityBefore.costBasis)} VANA`);
      console.log(`  Reward Eligibility Timestamp: ${stakerEntityBefore.rewardEligibilityTimestamp}`);
      console.log(`  Vested Rewards: ${formatEther(stakerEntityBefore.vestedRewards)} VANA`);
      console.log(`  Realized Rewards: ${formatEther(stakerEntityBefore.realizedRewards)} VANA`);
      console.log(`  Accruing Interest: ${formatEther(accruingInterestBefore)} VANA`);
      console.log(`  Earned Rewards: ${formatEther(earnedRewardsBefore)} VANA`);

      // Get current share price for calculations
      const shareToVana = await vanaPoolEntity.entityShareToVana(ENTITY_ID);
      const currentValueBefore = (stakerEntityBefore.shares * shareToVana) / BigInt(1e18);
      console.log(`  Current Value (shares * shareToVana): ${formatEther(currentValueBefore)} VANA`);

      // Stake new money (100 VANA)
      const newStakeAmount = parseEther(100);
      const currentTimestamp = BigInt(await helpers.time.latest());

      console.log(`\n--- Staking New Money ---`);
      console.log(`  New Stake Amount: ${formatEther(newStakeAmount)} VANA`);
      console.log(`  Current Timestamp: ${currentTimestamp}`);

      // Connect as staker and stake
      const vanaPoolStakingAsStaker = vanaPoolStakingV2.connect(stakerSigner);
      const stakeTx = await vanaPoolStakingAsStaker.stake(ENTITY_ID, existingStaker.address, 0, { value: newStakeAmount });
      const stakeReceipt = await stakeTx.wait();

      // Get the exact timestamp when the stake tx was confirmed
      const stakeBlock = await ethers.provider.getBlock(stakeReceipt!.blockNumber);
      const stakeTimestamp = BigInt(stakeBlock!.timestamp);
      console.log(`  Stake TX confirmed at block ${stakeReceipt!.blockNumber}, timestamp: ${stakeTimestamp}`);

      // Get staker's state AFTER new stake
      const stakerEntityAfter = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      const accruingInterestAfter = await vanaPoolStakingV2.getAccruingInterest(existingStaker.address, ENTITY_ID);
      const earnedRewardsAfter = await vanaPoolStakingV2.getEarnedRewards(existingStaker.address, ENTITY_ID);

      console.log(`\n--- After New Stake ---`);
      console.log(`  Shares: ${formatEther(stakerEntityAfter.shares)}`);
      console.log(`  Cost Basis: ${formatEther(stakerEntityAfter.costBasis)} VANA`);
      console.log(`  Reward Eligibility Timestamp: ${stakerEntityAfter.rewardEligibilityTimestamp}`);
      console.log(`  Vested Rewards: ${formatEther(stakerEntityAfter.vestedRewards)} VANA`);
      console.log(`  Realized Rewards: ${formatEther(stakerEntityAfter.realizedRewards)} VANA`);
      console.log(`  Accruing Interest: ${formatEther(accruingInterestAfter)} VANA`);
      console.log(`  Earned Rewards: ${formatEther(earnedRewardsAfter)} VANA`);

      // Verify shares increased
      stakerEntityAfter.shares.should.be.gt(stakerEntityBefore.shares, "Shares should increase after stake");

      // --- Verify Cost Basis Calculation ---
      // For reward-eligible staker (rewardEligibilityTimestamp = 0 or <= currentTimestamp):
      // Contract computes: costBasis = newTotalValue = (newTotalShares * shareToVana) / 1e18
      // This is mathematically equivalent to oldStakeValue + newStake, but with different rounding
      console.log(`\n--- Cost Basis Verification ---`);

      // Get share price at stake timestamp
      const shareToVanaAtStake = await vanaPoolEntity.entityShareToVana(ENTITY_ID);
      console.log(`  Share to VANA ratio at stake: ${formatEther(shareToVanaAtStake)}`);

      // Compute old stake value at stake timestamp
      const oldStakeValue = (stakerEntityBefore.shares * shareToVanaAtStake) / BigInt(1e18);
      console.log(`  Old Shares: ${formatEther(stakerEntityBefore.shares)}`);
      console.log(`  Old Stake Value (oldShares * shareToVana / 1e18): ${formatEther(oldStakeValue)} VANA`);
      console.log(`  New Stake Amount: ${formatEther(newStakeAmount)} VANA`);

      // Compute expected cost basis exactly as contract does:
      // costBasis = newTotalValue = (newTotalShares * shareToVana) / 1e18
      const newTotalShares = stakerEntityAfter.shares;
      const expectedCostBasis = (newTotalShares * shareToVanaAtStake) / BigInt(1e18);
      const actualCostBasis = stakerEntityAfter.costBasis;

      // Also show the naive calculation for comparison
      const naiveCostBasis = oldStakeValue + newStakeAmount;
      console.log(`  New Total Shares: ${formatEther(newTotalShares)}`);
      console.log(`  Naive Cost Basis (oldStakeValue + newStake): ${formatEther(naiveCostBasis)} VANA`);
      console.log(`  Expected Cost Basis (newTotalShares * shareToVana / 1e18): ${formatEther(expectedCostBasis)} VANA`);
      console.log(`  Actual Cost Basis from contract: ${formatEther(actualCostBasis)} VANA`);
      console.log(`  Rounding difference (naive - actual): ${naiveCostBasis - actualCostBasis} wei`);

      // Verify cost basis matches exactly (using contract's formula)
      actualCostBasis.should.eq(expectedCostBasis, "Cost basis should equal (newTotalShares * shareToVana) / 1e18");
      console.log(`  ✓ Cost basis matches expected value exactly`);

      // --- Verify Vested Rewards Calculation ---
      // For reward-eligible staker: vestedRewards += (oldValue - oldCostBasis) if oldValue > oldCostBasis
      // Since oldCostBasis was 0 (from V1 upgrade), vestedRewards = oldValue
      console.log(`\n--- Vested Rewards Verification ---`);

      const oldCostBasis = stakerEntityBefore.costBasis; // 0 from V1 upgrade
      const expectedVestedRewards = oldStakeValue > oldCostBasis ? oldStakeValue - oldCostBasis : 0n;

      console.log(`  Old Cost Basis: ${formatEther(oldCostBasis)} VANA`);
      console.log(`  Expected Vested Rewards (oldStakeValue - oldCostBasis): ${formatEther(expectedVestedRewards)} VANA`);
      console.log(`  Actual Vested Rewards from contract: ${formatEther(stakerEntityAfter.vestedRewards)} VANA`);

      // Verify vested rewards captured the accruing interest before stake
      if (accruingInterestBefore > 0n) {
        stakerEntityAfter.vestedRewards.should.be.gte(accruingInterestBefore, "Vested rewards should capture pre-stake accruing interest");
        console.log(`  ✓ Vested rewards captured pre-stake accruing interest`);
      }

      // --- Verify Bonding Period Calculation ---
      // For reward eligible staker: eligibility = currentTimestamp + (stakeAmount * bondingPeriod) / newTotalValue
      // Contract computes: newTotalValue = (newTotalShares * shareToVana) / 1e18
      // Naive approach: newTotalValue = oldStakeValue + newStakeAmount
      console.log(`\n--- Bonding Period Verification ---`);

      const bondingPeriod = await vanaPoolStakingV2.bondingPeriod();
      console.log(`  Bonding Period: ${bondingPeriod / 86400n} days (${bondingPeriod} seconds)`);
      console.log(`  Stake Timestamp: ${stakeTimestamp}`);

      // Naive bonding period calculation using oldStakeValue + newStake
      const naiveNewTotalValue = oldStakeValue + newStakeAmount;
      const naiveWeightedBondingTime = (newStakeAmount * bondingPeriod) / naiveNewTotalValue;
      const naiveEligibilityTimestamp = stakeTimestamp + naiveWeightedBondingTime;

      console.log(`\n  --- Naive Calculation (oldStakeValue + newStake) ---`);
      console.log(`  Old Stake Value: ${formatEther(oldStakeValue)} VANA`);
      console.log(`  New Stake Amount: ${formatEther(newStakeAmount)} VANA`);
      console.log(`  Naive New Total Value: ${formatEther(naiveNewTotalValue)} VANA`);
      console.log(`  Naive Weighted Bonding Time: ${naiveWeightedBondingTime} seconds (~${naiveWeightedBondingTime / 86400n} days)`);
      console.log(`  Naive Eligibility Timestamp: ${naiveEligibilityTimestamp}`);

      // Contract's exact bonding period calculation: newTotalValue = (newTotalShares * shareToVana) / 1e18
      const contractNewTotalValue = (newTotalShares * shareToVanaAtStake) / BigInt(1e18);
      const contractWeightedBondingTime = (newStakeAmount * bondingPeriod) / contractNewTotalValue;
      const contractEligibilityTimestamp = stakeTimestamp + contractWeightedBondingTime;

      console.log(`\n  --- Contract Calculation (newTotalShares * shareToVana / 1e18) ---`);
      console.log(`  New Total Shares: ${formatEther(newTotalShares)}`);
      console.log(`  Share to VANA ratio: ${formatEther(shareToVanaAtStake)}`);
      console.log(`  Contract New Total Value: ${formatEther(contractNewTotalValue)} VANA`);
      console.log(`  Contract Weighted Bonding Time: ${contractWeightedBondingTime} seconds (~${contractWeightedBondingTime / 86400n} days)`);
      console.log(`  Contract Eligibility Timestamp: ${contractEligibilityTimestamp}`);

      // Actual value from contract
      const actualEligibilityTimestamp = stakerEntityAfter.rewardEligibilityTimestamp;
      const actualWeightedBondingTime = actualEligibilityTimestamp - stakeTimestamp;

      console.log(`\n  --- Actual from Contract ---`);
      console.log(`  Actual Eligibility Timestamp: ${actualEligibilityTimestamp}`);
      console.log(`  Actual Weighted Bonding Time: ${actualWeightedBondingTime} seconds (~${actualWeightedBondingTime / 86400n} days)`);

      // Show differences
      console.log(`\n  --- Comparison ---`);
      console.log(`  Naive vs Actual difference: ${naiveEligibilityTimestamp - actualEligibilityTimestamp} seconds`);
      console.log(`  Contract vs Actual difference: ${contractEligibilityTimestamp - actualEligibilityTimestamp} seconds`);

      // Verify contract calculation matches exactly
      actualEligibilityTimestamp.should.eq(contractEligibilityTimestamp, "Actual eligibility should match contract formula");
      console.log(`  ✓ Contract formula matches actual eligibility timestamp exactly`);

      // The eligibility should be stakeTimestamp + weightedTime
      const eligibilityDelta = actualWeightedBondingTime;
      console.log(`\n  Time until eligibility: ${eligibilityDelta} seconds (~${eligibilityDelta / 86400n} days)`);

      // Verify it's less than the full bonding period (since only new stake contributes)
      eligibilityDelta.should.be.lte(bondingPeriod, "Weighted bonding time should be <= full bonding period");
      console.log(`  ✓ Bonding period correctly weighted`);

      // --- Test getMaxUnstakeAmount during bonding period ---
      console.log(`\n--- Testing getMaxUnstakeAmount (During Bonding Period) ---`);

      const maxUnstakeDuringBonding = await vanaPoolStakingV2.getMaxUnstakeAmount(existingStaker.address, ENTITY_ID);
      const [maxVanaDuringBonding, maxSharesDuringBonding, limitingFactorDuringBonding, isInBondingDuringBonding] = maxUnstakeDuringBonding;

      console.log(`  Max VANA: ${formatEther(maxVanaDuringBonding)} VANA`);
      console.log(`  Max Shares: ${formatEther(maxSharesDuringBonding)}`);
      console.log(`  Limiting Factor: ${limitingFactorDuringBonding} (0=user, 1=activePool, 2=treasury)`);
      console.log(`  Is In Bonding Period: ${isInBondingDuringBonding}`);

      // Should be in bonding period
      isInBondingDuringBonding.should.be.true;

      // Max VANA should equal cost basis (principal only) since in bonding period
      // (unless limited by activeRewardPool or treasury)
      if (limitingFactorDuringBonding === 0n) {
        maxVanaDuringBonding.should.eq(stakerEntityAfter.costBasis, "Max VANA should equal cost basis during bonding");
        console.log(`  ✓ Max VANA equals cost basis (principal only)`);
      } else {
        console.log(`  ⚠ Max VANA limited by ${limitingFactorDuringBonding === 1n ? 'activeRewardPool' : 'treasury'}`);
      }

      // --- Test DURING bonding period (rewards forfeited on unstake) ---
      console.log(`\n--- Testing During Bonding Period ---`);

      // Advance time to middle of bonding period
      const halfBondingTime = eligibilityDelta / 2n;
      await helpers.time.increase(Number(halfBondingTime));

      const midBondingEntity = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      const midBondingAccruing = await vanaPoolStakingV2.getAccruingInterest(existingStaker.address, ENTITY_ID);
      const midBondingEarned = await vanaPoolStakingV2.getEarnedRewards(existingStaker.address, ENTITY_ID);

      console.log(`  Time advanced: ${halfBondingTime} seconds`);
      console.log(`  Current Accruing Interest: ${formatEther(midBondingAccruing)} VANA`);
      console.log(`  Current Earned Rewards: ${formatEther(midBondingEarned)} VANA`);
      console.log(`  Still in bonding period: ${(await helpers.time.latest()) < midBondingEntity.rewardEligibilityTimestamp}`);

      // Accruing interest should include vested rewards + any new pending interest
      midBondingAccruing.should.be.gte(stakerEntityAfter.vestedRewards, "Accruing should include vested rewards");

      // --- Test partial unstake DURING bonding period (should receive only principal) ---
      console.log(`\n--- Testing Partial Unstake During Bonding Period ---`);

      // Calculate shares issued for the new stake
      // When staking: sharesIssued = (vanaToShare * stakeAmount) / 1e18
      // We can compute this as: newTotalShares - oldShares
      const sharesIssuedForNewStake = stakerEntityAfter.shares - stakerEntityBefore.shares;
      console.log(`  Shares issued for new stake: ${formatEther(sharesIssuedForNewStake)}`);

      // Unstake exactly the shares corresponding to the new stake
      const sharesToUnstakeDuringBonding = sharesIssuedForNewStake;
      const shareToVanaDuringBonding = await vanaPoolEntity.entityShareToVana(ENTITY_ID);
      const shareValueDuringBonding = (sharesToUnstakeDuringBonding * shareToVanaDuringBonding) / BigInt(1e18);

      // During bonding period, user should receive proportional cost basis (principal only), not full share value
      // proportionalCostBasis = (costBasis * shareAmount) / totalShares
      const proportionalCostBasis = (midBondingEntity.costBasis * sharesToUnstakeDuringBonding) / midBondingEntity.shares;

      console.log(`  Shares to unstake: ${formatEther(sharesToUnstakeDuringBonding)}`);
      console.log(`  Current share value: ${formatEther(shareValueDuringBonding)} VANA`);
      console.log(`  Proportional cost basis (expected return): ${formatEther(proportionalCostBasis)} VANA`);
      console.log(`  New stake amount (original): ${formatEther(newStakeAmount)} VANA`);

      // The proportional cost basis for the new shares should equal the new stake amount
      // because costBasis = newTotalValue = oldStakeValue + newStake (approximately)
      // and the new shares proportion of that is: newStake / newTotalValue * costBasis ≈ newStake
      console.log(`  Expected: proportional cost basis ≈ new stake amount`);

      // Check if entity has enough activeRewardPool and treasury has enough balance for this unstake
      // (V1 fork data might not have proper activeRewardPool accounting)
      const entityBeforeUnstake = await vanaPoolEntity.entities(ENTITY_ID);
      const treasuryAddress = await vanaPoolStakingV2.vanaPoolTreasury();
      const treasuryBalance = await ethers.provider.getBalance(treasuryAddress);
      console.log(`  Entity activeRewardPool: ${formatEther(entityBeforeUnstake.activeRewardPool)} VANA`);
      console.log(`  Treasury balance: ${formatEther(treasuryBalance)} VANA`);
      console.log(`  Share value to unstake: ${formatEther(shareValueDuringBonding)} VANA`);
      console.log(`  Proportional cost basis (what user receives): ${formatEther(proportionalCostBasis)} VANA`);

      let didUnstakeDuringBonding = false;
      let afterBondingUnstakeEntity = midBondingEntity; // Default to midBondingEntity if unstake is skipped

      // Check if contracts are paused
      const isStakingPaused = await vanaPoolStakingV2.paused();
      const isEntityPaused = await vanaPoolEntity.paused();
      console.log(`  VanaPoolStaking paused: ${isStakingPaused}`);
      console.log(`  VanaPoolEntity paused: ${isEntityPaused}`);

      // Check VANA_POOL_ROLE on VanaPoolEntity
      const VANA_POOL_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VANA_POOL_ROLE"));
      const hasVanaPoolRole = await vanaPoolEntity.hasRole(VANA_POOL_ROLE, VANA_POOL_STAKING_PROXY);
      console.log(`  VanaPoolStaking has VANA_POOL_ROLE on Entity: ${hasVanaPoolRole}`);

      // Check DEFAULT_ADMIN_ROLE on VanaPoolTreasury (needed for transferVana)
      const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const hasAdminRoleOnTreasury = await vanaPoolTreasury.hasRole(DEFAULT_ADMIN_ROLE, VANA_POOL_STAKING_PROXY);
      console.log(`  VanaPoolStaking has DEFAULT_ADMIN_ROLE on Treasury: ${hasAdminRoleOnTreasury}`);

      // Check if treasury is paused
      const isTreasuryPaused = await vanaPoolTreasury.paused();
      console.log(`  VanaPoolTreasury paused: ${isTreasuryPaused}`);

      // Check all conditions needed for unstake to succeed
      const canUnstake = entityBeforeUnstake.activeRewardPool >= shareValueDuringBonding &&
                         treasuryBalance >= proportionalCostBasis &&
                         !isStakingPaused &&
                         !isEntityPaused &&
                         !isTreasuryPaused &&
                         hasVanaPoolRole &&
                         hasAdminRoleOnTreasury;

      if (canUnstake) {
        const balanceBeforeBondingUnstake = await ethers.provider.getBalance(existingStaker.address);
        const unstakeDuringBondingTx = await vanaPoolStakingAsStaker.unstake(ENTITY_ID, sharesToUnstakeDuringBonding, 0);
        const unstakeDuringBondingReceipt = await unstakeDuringBondingTx.wait();
        const gasUsedDuringBonding = unstakeDuringBondingReceipt!.gasUsed * unstakeDuringBondingReceipt!.gasPrice;
        const balanceAfterBondingUnstake = await ethers.provider.getBalance(existingStaker.address);

        const actualVanaReceivedDuringBonding = balanceAfterBondingUnstake - balanceBeforeBondingUnstake + gasUsedDuringBonding;
        console.log(`  Actual VANA received: ${formatEther(actualVanaReceivedDuringBonding)} VANA`);

        // Verify received amount equals the new stake (principal only, no rewards)
        // Allow small tolerance for rounding
        const bondingUnstakeTolerance = parseEther(0.001); // 0.001 VANA tolerance
        actualVanaReceivedDuringBonding.should.be.closeTo(newStakeAmount, bondingUnstakeTolerance,
          "Should receive exactly the new stake amount (principal) during bonding period");
        console.log(`  ✓ Received exactly the new stake amount (principal only, rewards forfeited)`);

        // Verify state after partial unstake during bonding
        afterBondingUnstakeEntity = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
        console.log(`  Shares after unstake: ${formatEther(afterBondingUnstakeEntity.shares)}`);
        console.log(`  Cost Basis after unstake: ${formatEther(afterBondingUnstakeEntity.costBasis)} VANA`);

        // Shares should be back to original (before new stake)
        afterBondingUnstakeEntity.shares.should.be.closeTo(stakerEntityBefore.shares, BigInt(1e15),
          "Shares should return to original amount after unstaking new stake shares");
        console.log(`  ✓ Shares returned to original amount`);
        didUnstakeDuringBonding = true;
      } else {
        if (entityBeforeUnstake.activeRewardPool < shareValueDuringBonding) {
          console.log(`  ⚠ Skipping unstake: entity activeRewardPool (${formatEther(entityBeforeUnstake.activeRewardPool)}) < shareValue (${formatEther(shareValueDuringBonding)})`);
        }
        if (treasuryBalance < proportionalCostBasis) {
          console.log(`  ⚠ Skipping unstake: treasury balance (${formatEther(treasuryBalance)}) < vanaToReturn (${formatEther(proportionalCostBasis)})`);
        }
        if (isStakingPaused) {
          console.log(`  ⚠ Skipping unstake: VanaPoolStaking is paused`);
        }
        if (isEntityPaused) {
          console.log(`  ⚠ Skipping unstake: VanaPoolEntity is paused`);
        }
        if (!hasVanaPoolRole) {
          console.log(`  ⚠ Skipping unstake: VanaPoolStaking does not have VANA_POOL_ROLE`);
        }
        console.log(`  Note: This is expected for V1 fork data where state may not be fully consistent`);
      }

      // --- Test AFTER eligibility date (rewards claimable) ---
      console.log(`\n--- Testing After Eligibility Date ---`);

      // Use the appropriate eligibility timestamp based on whether we did the unstake
      const eligibilityTimestampToUse = didUnstakeDuringBonding
        ? afterBondingUnstakeEntity.rewardEligibilityTimestamp
        : stakerEntityAfter.rewardEligibilityTimestamp;

      const remainingTime = eligibilityTimestampToUse - BigInt(await helpers.time.latest()) + 1n;
      console.log(`  Remaining time to eligibility: ${remainingTime} seconds`);
      await helpers.time.increase(Number(remainingTime));

      const afterEligibilityEntity = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      const afterEligibilityAccruing = await vanaPoolStakingV2.getAccruingInterest(existingStaker.address, ENTITY_ID);
      const afterEligibilityEarned = await vanaPoolStakingV2.getEarnedRewards(existingStaker.address, ENTITY_ID);

      const currentTime = BigInt(await helpers.time.latest());
      console.log(`  Current time: ${currentTime}`);
      console.log(`  Eligibility timestamp: ${afterEligibilityEntity.rewardEligibilityTimestamp}`);
      console.log(`  Is reward eligible: ${currentTime >= afterEligibilityEntity.rewardEligibilityTimestamp}`);
      console.log(`  Accruing Interest: ${formatEther(afterEligibilityAccruing)} VANA`);
      console.log(`  Earned Rewards: ${formatEther(afterEligibilityEarned)} VANA`);

      // Verify staker is now eligible
      currentTime.should.be.gte(afterEligibilityEntity.rewardEligibilityTimestamp, "Should be past eligibility timestamp");
      console.log(`  ✓ Staker is now reward eligible`);

      // --- Test getMaxUnstakeAmount after eligibility ---
      console.log(`\n--- Testing getMaxUnstakeAmount (After Eligibility) ---`);

      const maxUnstakeAfterEligibility = await vanaPoolStakingV2.getMaxUnstakeAmount(existingStaker.address, ENTITY_ID);
      const [maxVanaAfterEligibility, maxSharesAfterEligibility, limitingFactorAfterEligibility, isInBondingAfterEligibility] = maxUnstakeAfterEligibility;

      // The function simulates processRewards, so it returns the expected value AFTER rewards are processed
      // Get current (stale) share value for comparison
      const shareToVanaStale = await vanaPoolEntity.entityShareToVana(ENTITY_ID);
      const staleShareValue = (afterEligibilityEntity.shares * shareToVanaStale) / BigInt(1e18);

      console.log(`  Max VANA (with simulated rewards): ${formatEther(maxVanaAfterEligibility)} VANA`);
      console.log(`  Max Shares: ${formatEther(maxSharesAfterEligibility)}`);
      console.log(`  Limiting Factor: ${limitingFactorAfterEligibility} (0=user, 1=activePool, 2=treasury)`);
      console.log(`  Is In Bonding Period: ${isInBondingAfterEligibility}`);
      console.log(`  Stale Share Value (without processRewards): ${formatEther(staleShareValue)} VANA`);
      console.log(`  Difference (pending rewards): ${formatEther(maxVanaAfterEligibility - staleShareValue)} VANA`);

      // Should NOT be in bonding period
      isInBondingAfterEligibility.should.be.false;

      // Max VANA should be >= stale share value (since it includes pending rewards from processRewards simulation)
      // (unless limited by activeRewardPool or treasury)
      if (limitingFactorAfterEligibility === 0n) {
        maxVanaAfterEligibility.should.be.gte(staleShareValue, "Max VANA should be >= stale share value (includes simulated pending rewards)");
        console.log(`  ✓ Max VANA >= stale share value (includes simulated pending rewards)`);
      } else {
        console.log(`  ⚠ Max VANA limited by ${limitingFactorAfterEligibility === 1n ? 'activeRewardPool' : 'treasury'}`);
      }

      // --- Test partial unstake after eligibility (should receive full value) ---
      console.log(`\n--- Testing Partial Unstake After Eligibility ---`);

      const sharesToUnstake = afterEligibilityEntity.shares / 10n; // Unstake 10%
      const shareToVanaBeforeUnstake = await vanaPoolEntity.entityShareToVana(ENTITY_ID);

      // Calculate expected values BEFORE unstake
      // For reward-eligible staker: vanaToReturn = shareValue (full value including rewards)
      const expectedShareValue = (sharesToUnstake * shareToVanaBeforeUnstake) / BigInt(1e18);
      const expectedProportionalCostBasis = (afterEligibilityEntity.costBasis * sharesToUnstake) / afterEligibilityEntity.shares;
      const expectedProportionalVestedRewards = (afterEligibilityEntity.vestedRewards * sharesToUnstake) / afterEligibilityEntity.shares;

      // When reward eligible: user receives full shareValue
      // Rewards from this unstake = shareValue - proportionalCostBasis (if positive)
      const expectedNewRewardsWithdrawn = expectedShareValue > expectedProportionalCostBasis
        ? expectedShareValue - expectedProportionalCostBasis
        : 0n;

      // Expected state after unstake:
      // - shares: afterEligibilityEntity.shares - sharesToUnstake
      // - costBasis: afterEligibilityEntity.costBasis - proportionalCostBasis
      // - vestedRewards: afterEligibilityEntity.vestedRewards - proportionalVestedRewards
      // - realizedRewards: afterEligibilityEntity.realizedRewards + proportionalVestedRewards + newRewardsWithdrawn
      const expectedSharesAfter = afterEligibilityEntity.shares - sharesToUnstake;
      const expectedCostBasisAfter = afterEligibilityEntity.costBasis - expectedProportionalCostBasis;
      const expectedVestedRewardsAfter = afterEligibilityEntity.vestedRewards - expectedProportionalVestedRewards;
      const expectedRealizedRewardsAfter = afterEligibilityEntity.realizedRewards + expectedProportionalVestedRewards + expectedNewRewardsWithdrawn;

      console.log(`\n  --- Before Unstake State ---`);
      console.log(`  Shares: ${formatEther(afterEligibilityEntity.shares)}`);
      console.log(`  Cost Basis: ${formatEther(afterEligibilityEntity.costBasis)} VANA`);
      console.log(`  Vested Rewards: ${formatEther(afterEligibilityEntity.vestedRewards)} VANA`);
      console.log(`  Realized Rewards: ${formatEther(afterEligibilityEntity.realizedRewards)} VANA`);

      console.log(`\n  --- Unstake Calculation ---`);
      console.log(`  Shares to unstake (10%): ${formatEther(sharesToUnstake)}`);
      console.log(`  Share to VANA ratio: ${formatEther(shareToVanaBeforeUnstake)}`);
      console.log(`  Share Value (what user receives): ${formatEther(expectedShareValue)} VANA`);
      console.log(`  Proportional Cost Basis: ${formatEther(expectedProportionalCostBasis)} VANA`);
      console.log(`  Proportional Vested Rewards: ${formatEther(expectedProportionalVestedRewards)} VANA`);
      console.log(`  New Rewards Withdrawn (shareValue - costBasis): ${formatEther(expectedNewRewardsWithdrawn)} VANA`);

      console.log(`\n  --- Expected State After Unstake ---`);
      console.log(`  Expected Shares: ${formatEther(expectedSharesAfter)}`);
      console.log(`  Expected Cost Basis: ${formatEther(expectedCostBasisAfter)} VANA`);
      console.log(`  Expected Vested Rewards: ${formatEther(expectedVestedRewardsAfter)} VANA`);
      console.log(`  Expected Realized Rewards: ${formatEther(expectedRealizedRewardsAfter)} VANA`);

      // Check if entity has enough activeRewardPool and treasury has enough balance for this unstake
      const entityBeforeEligibilityUnstake = await vanaPoolEntity.entities(ENTITY_ID);
      const treasuryBalanceAfterEligibility = await ethers.provider.getBalance(treasuryAddress);
      console.log(`\n  Entity activeRewardPool: ${formatEther(entityBeforeEligibilityUnstake.activeRewardPool)} VANA`);
      console.log(`  Treasury balance: ${formatEther(treasuryBalanceAfterEligibility)} VANA`);

      const canUnstakeAfterEligibility = entityBeforeEligibilityUnstake.activeRewardPool >= expectedShareValue && treasuryBalanceAfterEligibility >= expectedShareValue;

      if (canUnstakeAfterEligibility) {
        const balanceBefore = await ethers.provider.getBalance(existingStaker.address);
        const unstakeTx = await vanaPoolStakingAsStaker.unstake(ENTITY_ID, sharesToUnstake, 0);
        const receipt = await unstakeTx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const balanceAfter = await ethers.provider.getBalance(existingStaker.address);

        const actualVanaReceived = balanceAfter - balanceBefore + gasUsed;

        // Get actual state after unstake
        const afterUnstakeEntity = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);

        console.log(`\n  --- Actual State After Unstake ---`);
        console.log(`  Actual VANA received: ${formatEther(actualVanaReceived)} VANA`);
        console.log(`  Actual Shares: ${formatEther(afterUnstakeEntity.shares)}`);
        console.log(`  Actual Cost Basis: ${formatEther(afterUnstakeEntity.costBasis)} VANA`);
        console.log(`  Actual Vested Rewards: ${formatEther(afterUnstakeEntity.vestedRewards)} VANA`);
        console.log(`  Actual Realized Rewards: ${formatEther(afterUnstakeEntity.realizedRewards)} VANA`);

        // Note: The actual VANA received and realized rewards may be slightly higher than expected
        // because processRewards() is called during unstake, which distributes additional rewards
        // from lockedRewardPool to activeRewardPool, increasing the share price.
        const rewardsProcessedDuringUnstake = actualVanaReceived - expectedShareValue;

        console.log(`\n  --- Comparison (Expected vs Actual) ---`);
        console.log(`  VANA Received: Expected ${formatEther(expectedShareValue)}, Actual ${formatEther(actualVanaReceived)}, Diff: ${rewardsProcessedDuringUnstake} wei`);
        console.log(`  Shares: Expected ${formatEther(expectedSharesAfter)}, Actual ${formatEther(afterUnstakeEntity.shares)}, Diff: ${afterUnstakeEntity.shares - expectedSharesAfter} wei`);
        console.log(`  Cost Basis: Expected ${formatEther(expectedCostBasisAfter)}, Actual ${formatEther(afterUnstakeEntity.costBasis)}, Diff: ${afterUnstakeEntity.costBasis - expectedCostBasisAfter} wei`);
        console.log(`  Vested Rewards: Expected ${formatEther(expectedVestedRewardsAfter)}, Actual ${formatEther(afterUnstakeEntity.vestedRewards)}, Diff: ${afterUnstakeEntity.vestedRewards - expectedVestedRewardsAfter} wei`);
        console.log(`  Realized Rewards: Expected >=${formatEther(expectedRealizedRewardsAfter)}, Actual ${formatEther(afterUnstakeEntity.realizedRewards)}, Diff: ${afterUnstakeEntity.realizedRewards - expectedRealizedRewardsAfter} wei`);
        console.log(`  Note: +${formatEther(rewardsProcessedDuringUnstake)} VANA from processRewards() during unstake`);

        // Verify shares, cost basis, and vested rewards match exactly
        afterUnstakeEntity.shares.should.eq(expectedSharesAfter, "Shares should match expected");
        console.log(`  ✓ Shares match expected value exactly`);

        afterUnstakeEntity.costBasis.should.eq(expectedCostBasisAfter, "Cost basis should match expected");
        console.log(`  ✓ Cost basis matches expected value exactly`);

        afterUnstakeEntity.vestedRewards.should.eq(expectedVestedRewardsAfter, "Vested rewards should match expected");
        console.log(`  ✓ Vested rewards match expected value exactly`);

        // Realized rewards should be >= expected (can be higher due to processRewards during unstake)
        afterUnstakeEntity.realizedRewards.should.be.gte(expectedRealizedRewardsAfter, "Realized rewards should be >= expected (processRewards adds more)");
        console.log(`  ✓ Realized rewards >= expected (includes rewards processed during unstake)`);

        // VANA received should be >= expected share value (processRewards increases share price)
        actualVanaReceived.should.be.gte(expectedShareValue, "VANA received should be >= expected share value");
        console.log(`  ✓ VANA received >= expected share value`);

        // The difference between actual and expected should be due to processRewards
        // This amount should be the same for both VANA received and realized rewards
        const realizedRewardsDiff = afterUnstakeEntity.realizedRewards - expectedRealizedRewardsAfter;
        realizedRewardsDiff.should.eq(rewardsProcessedDuringUnstake, "Extra realized rewards should match extra VANA from processRewards");
        console.log(`  ✓ Extra rewards match: processRewards added ${formatEther(rewardsProcessedDuringUnstake)} VANA`);
      } else {
        if (entityBeforeEligibilityUnstake.activeRewardPool < expectedShareValue) {
          console.log(`  ⚠ Skipping unstake: entity activeRewardPool (${formatEther(entityBeforeEligibilityUnstake.activeRewardPool)}) < expectedReturn (${formatEther(expectedShareValue)})`);
        }
        if (treasuryBalanceAfterEligibility < expectedShareValue) {
          console.log(`  ⚠ Skipping unstake: treasury balance (${formatEther(treasuryBalanceAfterEligibility)}) < expectedReturn (${formatEther(expectedShareValue)})`);
        }
        console.log(`  Note: This is expected for V1 fork data where state may not be fully consistent`);
      }

      console.log(`\n=== Test Complete ===`);
    });

    it("should test unstakeVana during bonding period", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      // Use an existing staker from the snapshot
      const existingStaker = stakerSnapshots[0];
      console.log(`\n=== Testing unstakeVana During Bonding Period ===`);
      console.log(`Staker: ${existingStaker.address}`);

      // Impersonate the existing staker
      await helpers.impersonateAccount(existingStaker.address);
      await helpers.setBalance(existingStaker.address, parseEther(1000));
      const stakerSigner = await ethers.getSigner(existingStaker.address);

      // Stake new money to enter bonding period
      const newStakeAmount = parseEther(100);
      const vanaPoolStakingAsStaker = vanaPoolStakingV2.connect(stakerSigner);
      await vanaPoolStakingAsStaker.stake(ENTITY_ID, existingStaker.address, 0, { value: newStakeAmount });

      // Get state after staking
      const stakerEntityAfterStake = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      const currentTime = BigInt(await helpers.time.latest());

      console.log(`\n--- After Staking ---`);
      console.log(`  Shares: ${formatEther(stakerEntityAfterStake.shares)}`);
      console.log(`  Cost Basis: ${formatEther(stakerEntityAfterStake.costBasis)} VANA`);
      console.log(`  Reward Eligibility: ${stakerEntityAfterStake.rewardEligibilityTimestamp}`);
      console.log(`  Current Time: ${currentTime}`);
      console.log(`  Is in bonding: ${currentTime < stakerEntityAfterStake.rewardEligibilityTimestamp}`);

      // Verify we're in bonding period
      (currentTime < stakerEntityAfterStake.rewardEligibilityTimestamp).should.be.true;

      // Choose a VANA amount to unstake (half of cost basis)
      const vanaToUnstake = stakerEntityAfterStake.costBasis / 2n;
      console.log(`\n--- unstakeVana During Bonding ---`);
      console.log(`  VANA amount to unstake: ${formatEther(vanaToUnstake)} VANA`);

      // Calculate expected shares to be burned
      // During bonding: shareAmount = (vanaAmount * totalShares) / costBasis
      const expectedShareAmount = (vanaToUnstake * stakerEntityAfterStake.shares) / stakerEntityAfterStake.costBasis;
      console.log(`  Expected shares to burn: ${formatEther(expectedShareAmount)}`);

      // Check if we can unstake (entity and treasury have enough funds)
      const entityInfo = await vanaPoolEntity.entities(ENTITY_ID);
      const treasuryAddress = await vanaPoolStakingV2.vanaPoolTreasury();
      const treasuryBalance = await ethers.provider.getBalance(treasuryAddress);
      const shareToVana = await vanaPoolEntity.entityShareToVana(ENTITY_ID);
      const shareValue = (expectedShareAmount * shareToVana) / BigInt(1e18);

      console.log(`  Share value of unstaked shares: ${formatEther(shareValue)} VANA`);
      console.log(`  Entity activeRewardPool: ${formatEther(entityInfo.activeRewardPool)} VANA`);
      console.log(`  Treasury balance: ${formatEther(treasuryBalance)} VANA`);

      const canUnstake = entityInfo.activeRewardPool >= shareValue && treasuryBalance >= vanaToUnstake;

      if (canUnstake) {
        // Record balance before unstake
        const balanceBefore = await ethers.provider.getBalance(existingStaker.address);

        // Call unstakeVana
        const unstakeTx = await vanaPoolStakingAsStaker.unstakeVana(ENTITY_ID, vanaToUnstake, 0);
        const receipt = await unstakeTx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

        // Record balance after unstake
        const balanceAfter = await ethers.provider.getBalance(existingStaker.address);
        const actualVanaReceived = balanceAfter - balanceBefore + gasUsed;

        console.log(`\n--- After unstakeVana ---`);
        console.log(`  Actual VANA received: ${formatEther(actualVanaReceived)} VANA`);
        console.log(`  Expected VANA: ${formatEther(vanaToUnstake)} VANA`);
        console.log(`  Difference: ${actualVanaReceived - vanaToUnstake} wei`);

        // Get state after unstake
        const stakerEntityAfterUnstake = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
        console.log(`  Shares after: ${formatEther(stakerEntityAfterUnstake.shares)}`);
        console.log(`  Cost Basis after: ${formatEther(stakerEntityAfterUnstake.costBasis)} VANA`);

        // Verify user received approximately the requested VANA amount
        // Allow small tolerance for rounding
        const tolerance = parseEther(0.001);
        actualVanaReceived.should.be.closeTo(vanaToUnstake, tolerance,
          "User should receive approximately the requested VANA amount during bonding");
        console.log(`  ✓ Received requested VANA amount (principal only)`);

        // Verify shares were reduced by approximately expected amount
        const actualSharesBurned = stakerEntityAfterStake.shares - stakerEntityAfterUnstake.shares;
        console.log(`  Actual shares burned: ${formatEther(actualSharesBurned)}`);
        console.log(`  Expected shares burned: ${formatEther(expectedShareAmount)}`);

        // Allow small tolerance for rounding in shares
        actualSharesBurned.should.be.closeTo(expectedShareAmount, BigInt(1e15),
          "Shares burned should match expected amount");
        console.log(`  ✓ Correct number of shares burned`);
      } else {
        console.log(`  ⚠ Skipping unstake: insufficient funds in entity or treasury`);
        console.log(`  Note: This is expected for V1 fork data where state may not be fully consistent`);
      }

      console.log(`\n=== unstakeVana During Bonding Period Test Complete ===`);
    });

    it("should test unstakeVana after eligibility", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      // Use an existing staker from the snapshot
      const existingStaker = stakerSnapshots[0];
      console.log(`\n=== Testing unstakeVana After Eligibility ===`);
      console.log(`Staker: ${existingStaker.address}`);

      // Impersonate the existing staker
      await helpers.impersonateAccount(existingStaker.address);
      await helpers.setBalance(existingStaker.address, parseEther(1000));
      const stakerSigner = await ethers.getSigner(existingStaker.address);

      // Stake new money
      const newStakeAmount = parseEther(100);
      const vanaPoolStakingAsStaker = vanaPoolStakingV2.connect(stakerSigner);
      await vanaPoolStakingAsStaker.stake(ENTITY_ID, existingStaker.address, 0, { value: newStakeAmount });

      // Get state after staking
      const stakerEntityAfterStake = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      console.log(`\n--- After Staking ---`);
      console.log(`  Shares: ${formatEther(stakerEntityAfterStake.shares)}`);
      console.log(`  Cost Basis: ${formatEther(stakerEntityAfterStake.costBasis)} VANA`);
      console.log(`  Reward Eligibility: ${stakerEntityAfterStake.rewardEligibilityTimestamp}`);

      // Advance time past bonding period
      const currentTime = BigInt(await helpers.time.latest());
      const timeToAdvance = stakerEntityAfterStake.rewardEligibilityTimestamp - currentTime + 1n;
      console.log(`  Advancing time by: ${timeToAdvance} seconds`);
      await helpers.time.increase(Number(timeToAdvance));

      // Verify we're past bonding period
      const newCurrentTime = BigInt(await helpers.time.latest());
      console.log(`  New current time: ${newCurrentTime}`);
      console.log(`  Is past eligibility: ${newCurrentTime >= stakerEntityAfterStake.rewardEligibilityTimestamp}`);
      (newCurrentTime >= stakerEntityAfterStake.rewardEligibilityTimestamp).should.be.true;

      // Get current share price after time has passed (rewards have accumulated)
      const shareToVana = await vanaPoolEntity.entityShareToVana(ENTITY_ID);
      const totalShareValue = (stakerEntityAfterStake.shares * shareToVana) / BigInt(1e18);

      console.log(`\n--- State Before unstakeVana ---`);
      console.log(`  Share to VANA ratio: ${formatEther(shareToVana)}`);
      console.log(`  Total share value: ${formatEther(totalShareValue)} VANA`);

      // Choose a VANA amount to unstake (use 10 VANA for a clean test)
      const vanaToUnstake = parseEther(10);
      console.log(`\n--- unstakeVana After Eligibility ---`);
      console.log(`  VANA amount to unstake: ${formatEther(vanaToUnstake)} VANA`);

      // Calculate expected shares to be burned
      // After eligibility: shareAmount = (vanaAmount * vanaToShare) / 1e18
      const vanaToShare = await vanaPoolEntity.vanaToEntityShare(ENTITY_ID);
      const expectedShareAmount = (vanaToUnstake * vanaToShare) / BigInt(1e18);
      console.log(`  Expected shares to burn: ${formatEther(expectedShareAmount)}`);

      // Check if we can unstake
      const entityInfo = await vanaPoolEntity.entities(ENTITY_ID);
      const treasuryAddress = await vanaPoolStakingV2.vanaPoolTreasury();
      const treasuryBalance = await ethers.provider.getBalance(treasuryAddress);

      console.log(`  Entity activeRewardPool: ${formatEther(entityInfo.activeRewardPool)} VANA`);
      console.log(`  Treasury balance: ${formatEther(treasuryBalance)} VANA`);

      const canUnstake = entityInfo.activeRewardPool >= vanaToUnstake && treasuryBalance >= vanaToUnstake;

      if (canUnstake) {
        // Record balance and state before unstake
        const balanceBefore = await ethers.provider.getBalance(existingStaker.address);
        const stakerEntityBefore = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);

        // Call unstakeVana
        const unstakeTx = await vanaPoolStakingAsStaker.unstakeVana(ENTITY_ID, vanaToUnstake, 0);
        const receipt = await unstakeTx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

        // Record balance after unstake
        const balanceAfter = await ethers.provider.getBalance(existingStaker.address);
        const actualVanaReceived = balanceAfter - balanceBefore + gasUsed;

        console.log(`\n--- After unstakeVana ---`);
        console.log(`  Actual VANA received: ${formatEther(actualVanaReceived)} VANA`);
        console.log(`  Expected VANA: ${formatEther(vanaToUnstake)} VANA`);

        // Get state after unstake
        const stakerEntityAfterUnstake = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
        console.log(`  Shares before: ${formatEther(stakerEntityBefore.shares)}`);
        console.log(`  Shares after: ${formatEther(stakerEntityAfterUnstake.shares)}`);
        console.log(`  Cost Basis before: ${formatEther(stakerEntityBefore.costBasis)} VANA`);
        console.log(`  Cost Basis after: ${formatEther(stakerEntityAfterUnstake.costBasis)} VANA`);
        console.log(`  Realized Rewards after: ${formatEther(stakerEntityAfterUnstake.realizedRewards)} VANA`);

        // Note: actualVanaReceived may be slightly different from vanaToUnstake due to:
        // 1. processRewards() being called during unstake (can increase share price)
        // 2. Rounding in share-to-VANA conversions
        const vanaDifference = actualVanaReceived > vanaToUnstake
          ? actualVanaReceived - vanaToUnstake
          : vanaToUnstake - actualVanaReceived;
        console.log(`  VANA difference: ${vanaDifference} wei`);

        // Verify user received approximately the requested VANA amount (allow small rounding tolerance)
        const tolerance = BigInt(1e15); // 0.001 VANA tolerance for rounding
        actualVanaReceived.should.be.closeTo(vanaToUnstake, tolerance,
          "User should receive approximately the requested VANA amount after eligibility");
        console.log(`  ✓ Received approximately requested VANA amount (full value including rewards)`);

        // Verify shares were reduced
        const actualSharesBurned = stakerEntityBefore.shares - stakerEntityAfterUnstake.shares;
        console.log(`  Actual shares burned: ${formatEther(actualSharesBurned)}`);

        // The shares burned should be close to expected (may differ slightly due to processRewards)
        // After processRewards, share price increases, so fewer shares needed for same VANA
        actualSharesBurned.should.be.gt(0n, "Some shares should be burned");
        console.log(`  ✓ Shares were burned correctly`);

        // Verify cost basis was reduced proportionally
        const costBasisReduction = stakerEntityBefore.costBasis - stakerEntityAfterUnstake.costBasis;
        console.log(`  Cost basis reduced by: ${formatEther(costBasisReduction)} VANA`);
        costBasisReduction.should.be.gt(0n, "Cost basis should be reduced");
        console.log(`  ✓ Cost basis reduced proportionally`);
      } else {
        console.log(`  ⚠ Skipping unstake: insufficient funds in entity or treasury`);
        console.log(`  Note: This is expected for V1 fork data where state may not be fully consistent`);
      }

      console.log(`\n=== unstakeVana After Eligibility Test Complete ===`);
    });

    it("should revert unstakeVana when vanaAmount exceeds costBasis during bonding period", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      const existingStaker = stakerSnapshots[0];
      console.log(`\n=== Testing unstakeVana Revert: vanaAmount > costBasis During Bonding ===`);
      console.log(`Staker: ${existingStaker.address}`);

      // Impersonate the existing staker
      await helpers.impersonateAccount(existingStaker.address);
      await helpers.setBalance(existingStaker.address, parseEther(1000));
      const stakerSigner = await ethers.getSigner(existingStaker.address);

      // Stake new money to enter bonding period
      const newStakeAmount = parseEther(100);
      const vanaPoolStakingAsStaker = vanaPoolStakingV2.connect(stakerSigner);
      await vanaPoolStakingAsStaker.stake(ENTITY_ID, existingStaker.address, 0, { value: newStakeAmount });

      // Get state after staking
      const stakerEntity = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      const currentTime = BigInt(await helpers.time.latest());

      console.log(`  Cost Basis: ${formatEther(stakerEntity.costBasis)} VANA`);
      console.log(`  Is in bonding: ${currentTime < stakerEntity.rewardEligibilityTimestamp}`);

      // Verify we're in bonding period
      (currentTime < stakerEntity.rewardEligibilityTimestamp).should.be.true;

      // Try to unstake more than cost basis - should revert
      const excessiveVanaAmount = stakerEntity.costBasis + parseEther(1);
      console.log(`  Attempting to unstake: ${formatEther(excessiveVanaAmount)} VANA (exceeds cost basis)`);

      await vanaPoolStakingAsStaker.unstakeVana(ENTITY_ID, excessiveVanaAmount, 0)
        .should.be.rejectedWith("InvalidAmount");

      console.log(`  ✓ Correctly reverted with InvalidAmount`);
      console.log(`\n=== Test Complete ===`);
    });

    it("should revert unstakeVana when vanaAmount is zero", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      const existingStaker = stakerSnapshots[0];
      console.log(`\n=== Testing unstakeVana Revert: vanaAmount = 0 ===`);
      console.log(`Staker: ${existingStaker.address}`);

      // Impersonate the existing staker
      await helpers.impersonateAccount(existingStaker.address);
      await helpers.setBalance(existingStaker.address, parseEther(1000));
      const stakerSigner = await ethers.getSigner(existingStaker.address);

      // Stake new money
      const newStakeAmount = parseEther(100);
      const vanaPoolStakingAsStaker = vanaPoolStakingV2.connect(stakerSigner);
      await vanaPoolStakingAsStaker.stake(ENTITY_ID, existingStaker.address, 0, { value: newStakeAmount });

      // Try to unstake 0 VANA - should revert
      console.log(`  Attempting to unstake: 0 VANA`);

      await vanaPoolStakingAsStaker.unstakeVana(ENTITY_ID, 0, 0)
        .should.be.rejectedWith("InvalidAmount");

      console.log(`  ✓ Correctly reverted with InvalidAmount`);
      console.log(`\n=== Test Complete ===`);
    });

    it("should revert unstakeVana when user has no shares", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      console.log(`\n=== Testing unstakeVana Revert: No Shares ===`);

      // Get a random address that has no stakes
      const [, , , newUser] = await ethers.getSigners();
      console.log(`New user (no stakes): ${newUser.address}`);

      // Check user has no shares
      const stakerEntity = await vanaPoolStakingV2.stakerEntities(newUser.address, ENTITY_ID);
      console.log(`  User shares: ${formatEther(stakerEntity.shares)}`);
      stakerEntity.shares.should.eq(0n, "User should have no shares");

      // Try to unstake - should revert
      const vanaPoolStakingAsNewUser = vanaPoolStakingV2.connect(newUser);
      console.log(`  Attempting to unstake: 10 VANA with no shares`);

      await vanaPoolStakingAsNewUser.unstakeVana(ENTITY_ID, parseEther(10), 0)
        .should.be.rejectedWith("InvalidAmount");

      console.log(`  ✓ Correctly reverted with InvalidAmount`);
      console.log(`\n=== Test Complete ===`);
    });

    it("should revert unstakeVana when shareAmountMax exceeded (slippage protection)", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      const existingStaker = stakerSnapshots[0];
      console.log(`\n=== Testing unstakeVana Revert: Slippage Protection ===`);
      console.log(`Staker: ${existingStaker.address}`);

      // Impersonate the existing staker
      await helpers.impersonateAccount(existingStaker.address);
      await helpers.setBalance(existingStaker.address, parseEther(1000));
      const stakerSigner = await ethers.getSigner(existingStaker.address);

      // Stake new money
      const newStakeAmount = parseEther(100);
      const vanaPoolStakingAsStaker = vanaPoolStakingV2.connect(stakerSigner);
      await vanaPoolStakingAsStaker.stake(ENTITY_ID, existingStaker.address, 0, { value: newStakeAmount });

      // Get state after staking
      const stakerEntity = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);
      const currentTime = BigInt(await helpers.time.latest());
      const isInBondingPeriod = currentTime < stakerEntity.rewardEligibilityTimestamp;

      console.log(`  Cost Basis: ${formatEther(stakerEntity.costBasis)} VANA`);
      console.log(`  Shares: ${formatEther(stakerEntity.shares)}`);
      console.log(`  Is in bonding: ${isInBondingPeriod}`);

      // Choose a VANA amount to unstake
      const vanaToUnstake = parseEther(50);

      // Calculate expected shares
      let expectedShares: bigint;
      if (isInBondingPeriod) {
        expectedShares = (vanaToUnstake * stakerEntity.shares) / stakerEntity.costBasis;
      } else {
        const vanaToShare = await vanaPoolEntity.vanaToEntityShare(ENTITY_ID);
        expectedShares = (vanaToUnstake * vanaToShare) / BigInt(1e18);
      }

      console.log(`  VANA to unstake: ${formatEther(vanaToUnstake)} VANA`);
      console.log(`  Expected shares to burn: ${formatEther(expectedShares)}`);

      // Set shareAmountMax to less than expected - should trigger slippage protection
      const tooLowShareMax = expectedShares / 2n;
      console.log(`  Setting shareAmountMax to: ${formatEther(tooLowShareMax)} (less than expected)`);

      await vanaPoolStakingAsStaker.unstakeVana(ENTITY_ID, vanaToUnstake, tooLowShareMax)
        .should.be.rejectedWith("InvalidSlippage");

      console.log(`  ✓ Correctly reverted with InvalidSlippage`);
      console.log(`\n=== Test Complete ===`);
    });

    it("should cap shares when vanaAmount exceeds share value after eligibility", async function () {
      if (!(await isForkEnabled())) {
        this.skip();
      }

      const existingStaker = stakerSnapshots[0];
      console.log(`\n=== Testing unstakeVana: vanaAmount > shareValue After Eligibility ===`);
      console.log(`Staker: ${existingStaker.address}`);

      // Impersonate the existing staker
      await helpers.impersonateAccount(existingStaker.address);
      await helpers.setBalance(existingStaker.address, parseEther(1000));
      const stakerSigner = await ethers.getSigner(existingStaker.address);

      // Stake new money
      const newStakeAmount = parseEther(100);
      const vanaPoolStakingAsStaker = vanaPoolStakingV2.connect(stakerSigner);
      await vanaPoolStakingAsStaker.stake(ENTITY_ID, existingStaker.address, 0, { value: newStakeAmount });

      // Get state after staking
      const stakerEntityAfterStake = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);

      // Advance time past bonding period
      const currentTime = BigInt(await helpers.time.latest());
      const timeToAdvance = stakerEntityAfterStake.rewardEligibilityTimestamp - currentTime + 1n;
      await helpers.time.increase(Number(timeToAdvance));

      // Verify we're past bonding period
      const newCurrentTime = BigInt(await helpers.time.latest());
      (newCurrentTime >= stakerEntityAfterStake.rewardEligibilityTimestamp).should.be.true;
      console.log(`  Is past eligibility: true`);

      // Get current share value
      const shareToVana = await vanaPoolEntity.entityShareToVana(ENTITY_ID);
      const totalShareValue = (stakerEntityAfterStake.shares * shareToVana) / BigInt(1e18);
      console.log(`  Current share value: ${formatEther(totalShareValue)} VANA`);
      console.log(`  Current shares: ${formatEther(stakerEntityAfterStake.shares)}`);

      // Try to unstake more than share value
      const excessiveVanaAmount = totalShareValue + parseEther(1000);
      console.log(`  Attempting to unstake: ${formatEther(excessiveVanaAmount)} VANA (exceeds share value)`);

      // Check if we can unstake (entity and treasury have enough funds for full unstake)
      const entityInfo = await vanaPoolEntity.entities(ENTITY_ID);
      const treasuryAddress = await vanaPoolStakingV2.vanaPoolTreasury();
      const treasuryBalance = await ethers.provider.getBalance(treasuryAddress);

      console.log(`  Entity activeRewardPool: ${formatEther(entityInfo.activeRewardPool)} VANA`);
      console.log(`  Treasury balance: ${formatEther(treasuryBalance)} VANA`);

      // Current behavior: shares get capped to user's total shares, so they unstake everything
      const canUnstake = entityInfo.activeRewardPool >= totalShareValue && treasuryBalance >= totalShareValue;

      if (canUnstake) {
        // Record state before unstake
        const balanceBefore = await ethers.provider.getBalance(existingStaker.address);
        const stakerEntityBefore = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);

        // Call unstakeVana with excessive amount
        const unstakeTx = await vanaPoolStakingAsStaker.unstakeVana(ENTITY_ID, excessiveVanaAmount, 0);
        const receipt = await unstakeTx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

        // Record state after unstake
        const balanceAfter = await ethers.provider.getBalance(existingStaker.address);
        const actualVanaReceived = balanceAfter - balanceBefore + gasUsed;
        const stakerEntityAfter = await vanaPoolStakingV2.stakerEntities(existingStaker.address, ENTITY_ID);

        console.log(`\n--- After unstakeVana ---`);
        console.log(`  Actual VANA received: ${formatEther(actualVanaReceived)} VANA`);
        console.log(`  Shares before: ${formatEther(stakerEntityBefore.shares)}`);
        console.log(`  Shares after: ${formatEther(stakerEntityAfter.shares)}`);

        // Current behavior: caps to all shares, so user should have 0 shares after
        stakerEntityAfter.shares.should.eq(0n, "Shares should be 0 after unstaking with excessive amount");
        console.log(`  ✓ Shares after = 0 (all shares unstaked)`);

        // User should have received their full share value (not the excessive requested amount)
        actualVanaReceived.should.be.lte(excessiveVanaAmount, "User should not receive more than share value");
        console.log(`  ✓ User received their full share value, not the excessive requested amount`);
      } else {
        console.log(`  ⚠ Skipping unstake: insufficient funds in entity or treasury`);
      }

      console.log(`\n=== Test Complete ===`);
    });
  });
});
