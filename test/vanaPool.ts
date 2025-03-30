import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { formatEther } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {
  VanaPoolStakingImplementation,
  VanaPoolEntityImplementation,
  VanaPoolTreasuryImplementation,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import {
  advanceToTimestamp,
  getCurrentBlockTimestamp,
} from "../utils/timeAndBlockManipulation";

chai.use(chaiAsPromised);
should();

describe("VanaPool", () => {
  // Define participant roles
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let user4: HardhatEthersSigner;
  let user5: HardhatEthersSigner;
  let trustedForwarder: HardhatEthersSigner;

  // Contract instances
  let vanaPoolStaking: VanaPoolStakingImplementation;
  let vanaPoolEntity: VanaPoolEntityImplementation;
  let vanaPoolTreasury: VanaPoolTreasuryImplementation;

  // Constants
  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const VANA_POOL_ENTITY = ethers.keccak256(
    ethers.toUtf8Bytes("VANA_POOL_ENTITY"),
  );
  const VANA_POOL_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VANA_POOL_ROLE"));

  // Configuration constants
  const minStakeAmount = parseEther(0.1); // 0.1 VANA
  const minRegistrationStake = parseEther(1); // 1 VANA
  const maxDefaultApy = parseEther(6); // 6% APY

  const day = 24 * 3600;
  const week = day * 7;
  const month = day * 30;
  const year = day * 365;

  enum EntityStatus {
    None,
    Active,
    Removed,
  }

  // Entity creation info type
  type EntityRegistrationInfo = {
    ownerAddress: string;
    name: string;
  };

  const deploy = async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    [owner, maintainer, user1, user2, user3, user4, user5, trustedForwarder] =
      await ethers.getSigners();

    // Deploy VanaPool
    const vanaPoolDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("VanaPoolStakingImplementation"),
      [trustedForwarder.address, owner.address, minStakeAmount],
      {
        kind: "uups",
      },
    );

    vanaPoolStaking = await ethers.getContractAt(
      "VanaPoolStakingImplementation",
      vanaPoolDeploy.target,
    );

    // Deploy VanaPoolTreasury first
    const treasuryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("VanaPoolTreasuryImplementation"),
      [owner.address, vanaPoolStaking.target],
      {
        kind: "uups",
      },
    );

    vanaPoolTreasury = await ethers.getContractAt(
      "VanaPoolTreasuryImplementation",
      treasuryDeploy.target,
    );

    // Deploy VanaPoolEntity
    const entityDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("VanaPoolEntityImplementation"),
      [
        owner.address,
        vanaPoolStaking.target,
        minRegistrationStake,
        maxDefaultApy,
      ],
      {
        kind: "uups",
      },
    );

    vanaPoolEntity = await ethers.getContractAt(
      "VanaPoolEntityImplementation",
      entityDeploy.target,
    );

    // Configure contracts to work together
    await vanaPoolStaking
      .connect(owner)
      .updateVanaPoolEntity(vanaPoolEntity.target);
    await vanaPoolStaking
      .connect(owner)
      .updateVanaPoolTreasury(vanaPoolTreasury.target);

    // Assign roles
    await vanaPoolStaking
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);
    await vanaPoolEntity
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct initial values", async function () {
      // Check VanaPool
      (
        await vanaPoolStaking.hasRole(DEFAULT_ADMIN_ROLE, owner.address)
      ).should.eq(true);
      (await vanaPoolStaking.hasRole(MAINTAINER_ROLE, owner.address)).should.eq(
        true,
      );
      (
        await vanaPoolStaking.hasRole(MAINTAINER_ROLE, maintainer.address)
      ).should.eq(true);
      (await vanaPoolStaking.version()).should.eq(1);
      (await vanaPoolStaking.minStakeAmount()).should.eq(minStakeAmount);
      (await vanaPoolStaking.vanaPoolEntity()).should.eq(vanaPoolEntity.target);
      (await vanaPoolStaking.vanaPoolTreasury()).should.eq(
        vanaPoolTreasury.target,
      );
      (await vanaPoolStaking.trustedForwarder()).should.eq(
        trustedForwarder.address,
      );

      // Check VanaPoolEntity
      (
        await vanaPoolEntity.hasRole(DEFAULT_ADMIN_ROLE, owner.address)
      ).should.eq(true);
      (await vanaPoolEntity.hasRole(MAINTAINER_ROLE, owner.address)).should.eq(
        true,
      );
      (
        await vanaPoolEntity.hasRole(MAINTAINER_ROLE, maintainer.address)
      ).should.eq(true);
      (
        await vanaPoolEntity.hasRole(VANA_POOL_ROLE, vanaPoolStaking.target)
      ).should.eq(true);
      (await vanaPoolEntity.version()).should.eq(1);
      (await vanaPoolEntity.minRegistrationStake()).should.eq(
        minRegistrationStake,
      );
      (await vanaPoolEntity.maxAPYDefault()).should.eq(maxDefaultApy);
      (await vanaPoolEntity.vanaPoolStaking()).should.eq(
        vanaPoolStaking.target,
      );
      (await vanaPoolEntity.entitiesCount()).should.eq(0);

      // Check VanaPoolTreasury
      (
        await vanaPoolTreasury.hasRole(DEFAULT_ADMIN_ROLE, owner.address)
      ).should.eq(true);
      (
        await vanaPoolTreasury.hasRole(
          DEFAULT_ADMIN_ROLE,
          vanaPoolStaking.target,
        )
      ).should.eq(true);
      (await vanaPoolTreasury.version()).should.eq(1);
      (await vanaPoolTreasury.vanaPool()).should.eq(vanaPoolStaking.target);
    });

    it("should pause and unpause when maintainer", async function () {
      // Test VanaPoolStaking pause and unpause
      await vanaPoolStaking
        .connect(maintainer)
        .pause()
        .should.emit(vanaPoolStaking, "Paused");
      (await vanaPoolStaking.paused()).should.equal(true);

      await vanaPoolStaking
        .connect(maintainer)
        .unpause()
        .should.emit(vanaPoolStaking, "Unpaused");
      (await vanaPoolStaking.paused()).should.equal(false);

      // Test VanaPoolEntity pause and unpause
      await vanaPoolEntity
        .connect(maintainer)
        .pause()
        .should.emit(vanaPoolEntity, "Paused");
      (await vanaPoolEntity.paused()).should.equal(true);

      await vanaPoolEntity
        .connect(maintainer)
        .unpause()
        .should.emit(vanaPoolEntity, "Unpaused");
      (await vanaPoolEntity.paused()).should.equal(false);
    });

    it("should reject pause and unpause when non-maintainer", async function () {
      await vanaPoolStaking
        .connect(user1)
        .pause()
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      await vanaPoolStaking.connect(maintainer).pause();
      await vanaPoolStaking
        .connect(user1)
        .unpause()
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      await vanaPoolEntity
        .connect(user1)
        .pause()
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should update minStakeAmount when maintainer", async function () {
      const newMinStake = parseEther(0.2);
      await vanaPoolStaking
        .connect(maintainer)
        .updateMinStakeAmount(newMinStake)
        .should.emit(vanaPoolStaking, "MinStakeUpdated")
        .withArgs(newMinStake);

      (await vanaPoolStaking.minStakeAmount()).should.eq(newMinStake);
    });

    it("should reject updateMinStakeAmount when non-maintainer", async function () {
      await vanaPoolStaking
        .connect(user1)
        .updateMinStakeAmount(parseEther(0.2))
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should update trustedForwarder when maintainer", async function () {
      await vanaPoolStaking
        .connect(maintainer)
        .updateTrustedForwarder(user1.address);
      (await vanaPoolStaking.trustedForwarder()).should.eq(user1.address);
    });

    it("should reject updateTrustedForwarder when non-maintainer", async function () {
      await vanaPoolStaking
        .connect(user1)
        .updateTrustedForwarder(user2.address)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });
  });

  describe("Entity Management", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createEntity = async (entityInfo: EntityRegistrationInfo) => {
      return vanaPoolEntity
        .connect(maintainer)
        .createEntity(entityInfo, { value: minRegistrationStake });
    };

    it("should create an entity successfully", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "Test Entity",
      };

      const treasuryBalanceBefore = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      const tx = await createEntity(entityInfo);
      const receipt = await getReceipt(tx);

      await tx.should
        .emit(vanaPoolEntity, "EntityCreated")
        .withArgs(1, user1.address, "Test Entity", maxDefaultApy)
        .and.emit(vanaPoolEntity, "EntityStatusUpdated")
        .withArgs(1, EntityStatus.Active)
        .and.emit(vanaPoolStaking, "Staked");

      const entityCount = await vanaPoolEntity.entitiesCount();
      entityCount.should.eq(1);

      const entityData = await vanaPoolEntity.entities(1);
      entityData.entityId.should.eq(1);
      entityData.ownerAddress.should.eq(user1.address);
      entityData.name.should.eq("Test Entity");
      entityData.maxAPY.should.eq(maxDefaultApy);
      entityData.status.should.eq(EntityStatus.Active);
      entityData.totalShares.should.eq(minRegistrationStake);
      entityData.activeRewardPool.should.eq(minRegistrationStake);

      // Verify name mapping
      (await vanaPoolEntity.entityNameToId("Test Entity")).should.eq(1);

      // Verify stake registration in VanaPool
      const ownerShares = (
        await vanaPoolStaking.stakerEntities(user1.address, 1)
      ).shares;
      ownerShares.should.eq(minRegistrationStake);

      // Verify funds were sent to treasury
      const treasuryBalanceAfter = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      treasuryBalanceAfter.should.eq(
        treasuryBalanceBefore + minRegistrationStake,
      );
    });

    it("should reject entity creation with same name", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "Test Entity",
      };

      await createEntity(entityInfo);

      const entityInfo2 = {
        ownerAddress: user2.address,
        name: "Test Entity", // Same name as first entity
      };

      await createEntity(entityInfo2).should.rejectedWith("InvalidName()");
    });

    it("should reject entity creation with name too short", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "ABC", // Less than 4 characters
      };

      await createEntity(entityInfo).should.rejectedWith("InvalidName()");
    });

    it("should reject entity creation with wrong registration stake", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "Test Entity",
      };

      await vanaPoolEntity
        .connect(maintainer)
        .createEntity(entityInfo, { value: minRegistrationStake - BigInt(1) })
        .should.rejectedWith("InvalidRegistrationStake()");
    });

    it("should update entity information successfully", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "Test Entity",
      };

      await createEntity(entityInfo);

      const updatedInfo = {
        ownerAddress: user2.address, // Updated owner
        name: "Updated Entity Name", // Updated name
      };

      await vanaPoolEntity
        .connect(user1)
        .updateEntity(1, updatedInfo)
        .should.emit(vanaPoolEntity, "EntityUpdated")
        .withArgs(1, user2.address, "Updated Entity Name");

      const entityData = await vanaPoolEntity.entities(1);
      entityData.ownerAddress.should.eq(user2.address);
      entityData.name.should.eq("Updated Entity Name");

      // Old name mapping should be removed
      (await vanaPoolEntity.entityNameToId("Test Entity")).should.eq(0);

      // New name mapping should be set
      (await vanaPoolEntity.entityNameToId("Updated Entity Name")).should.eq(1);
    });

    it("should reject entity update when not owner", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "Test Entity",
      };

      await createEntity(entityInfo);

      const updatedInfo = {
        ownerAddress: user2.address,
        name: "Updated Entity Name",
      };

      await vanaPoolEntity
        .connect(user2)
        .updateEntity(1, updatedInfo)
        .should.rejectedWith("NotEntityOwner()");
    });

    // The removeEntity() function is commented out in the interface, so these tests are commented too
    /*
    it("should remove entity successfully", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "Test Entity",
      };

      await createEntity(entityInfo);

      await vanaPoolEntity
        .connect(user1)
        .removeEntity(1)
        .should.emit(vanaPoolEntity, "EntityStatusUpdated")
        .withArgs(1, EntityStatus.Removed);

      const entityData = await vanaPoolEntity.entities(1);
      entityData.status.should.eq(EntityStatus.Removed);

      // Try to stake in removed entity (should fail)
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, 0, { value: parseEther(1) })
        .should.rejectedWith("EntityNotActive()");
    });

    it("should reject entity removal when not owner", async function () {
      const entityInfo = {
        ownerAddress: user1.address,
        name: "Test Entity",
      };

      await createEntity(entityInfo);

      await vanaPoolEntity
        .connect(user2)
        .removeEntity(1)
        .should.rejectedWith("NotEntityOwner()");
    });
    */
  });

  describe("Staking Operations with lockedPoolAmount = 0", () => {
    let entityCreationTimestamp: number;
    beforeEach(async () => {
      await deploy();

      // Create an entity for testing staking operations
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: minRegistrationStake },
      );

      entityCreationTimestamp = await getCurrentBlockTimestamp();
    });

    it("should stake successfully in an entity for self", async function () {
      const stakeAmount = parseEther(2);
      const user2BalanceBefore = await ethers.provider.getBalance(user2);
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      await advanceToTimestamp(entityCreationTimestamp + 86400); // 1 day after entity creation
      // Stake for self (user2 as sender and recipient)
      const tx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount }); // shareAmountMin set to 0 for this test
      const receipt = await getReceipt(tx);

      await tx.should
        .emit(vanaPoolStaking, "Staked")
        .withArgs(1, user2.address, stakeAmount, stakeAmount);

      // Verify user's balance update
      const user2BalanceAfter = await ethers.provider.getBalance(user2);
      user2BalanceAfter.should.eq(
        user2BalanceBefore - stakeAmount - receipt.fee,
      );

      // Verify treasury received funds
      const treasuryBalanceAfter = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      treasuryBalanceAfter.should.eq(treasuryBalanceBefore + stakeAmount);

      // Verify user's shares
      const userShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      userShares.should.eq(stakeAmount);

      // Verify entity stats update
      const entityAfter = await vanaPoolEntity.entities(1);
      entityAfter.totalShares.should.eq(minRegistrationStake + stakeAmount);
      entityAfter.activeRewardPool.should.eq(
        minRegistrationStake + stakeAmount,
      );

      (await vanaPoolEntity.entityShareToVana(1)).should.eq(parseEther(1));
      (await vanaPoolEntity.vanaToEntityShare(1)).should.eq(parseEther(1));
    });

    it("should stake successfully in an entity for another user", async function () {
      const stakeAmount = parseEther(2);
      const user2BalanceBefore = await ethers.provider.getBalance(user2);
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      // User2 stakes for user3
      const tx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user3.address, 0, { value: stakeAmount }); // shareAmountMin set to 0
      const receipt = await getReceipt(tx);

      await tx.should
        .emit(vanaPoolStaking, "Staked")
        .withArgs(1, user3.address, stakeAmount, stakeAmount);

      // Verify staker's balance update
      const user2BalanceAfter = await ethers.provider.getBalance(user2);
      user2BalanceAfter.should.eq(
        user2BalanceBefore - stakeAmount - receipt.fee,
      );

      // Verify treasury received funds
      const treasuryBalanceAfter = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      treasuryBalanceAfter.should.eq(treasuryBalanceBefore + stakeAmount);

      // Verify recipient's shares
      const user3Shares = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;
      user3Shares.should.eq(stakeAmount);

      // Verify staker has no shares
      const user2Shares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      user2Shares.should.eq(0n);

      // Verify entity stats update
      const entityAfter = await vanaPoolEntity.entities(1);
      entityAfter.totalShares.should.eq(minRegistrationStake + stakeAmount);
      entityAfter.activeRewardPool.should.eq(
        minRegistrationStake + stakeAmount,
      );

      (await vanaPoolEntity.entityShareToVana(1)).should.eq(parseEther(1));
      (await vanaPoolEntity.vanaToEntityShare(1)).should.eq(parseEther(1));
    });

    it("should reject stake with invalid recipient", async function () {
      await vanaPoolStaking
        .connect(user2)
        .stake(1, ethers.ZeroAddress, 0, { value: parseEther(1) })
        .should.rejectedWith("InvalidRecipient()");
    });

    it("should reject stake for non-existent entity", async function () {
      await vanaPoolStaking
        .connect(user2)
        .stake(999, user2.address, 0, { value: parseEther(1) })
        .should.rejectedWith("EntityNotActive()");
    });

    it("should reject stake with invalid slippage", async function () {
      // Get share price first to calculate expected shares
      const vanaToShare = await vanaPoolEntity.vanaToEntityShare(1);
      const stakeAmount = parseEther(2);
      const expectedShares = (vanaToShare * stakeAmount) / parseEther(1);

      // Set minimum shares to more than would be received
      const tooHighMinShares = expectedShares * BigInt(2);

      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, tooHighMinShares, { value: stakeAmount })
        .should.rejectedWith("InvalidSlippage()");
    });

    it("should unstake successfully from an entity", async function () {
      // First stake some VANA
      const stakeAmount = parseEther(2);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const user2BalanceBefore = await ethers.provider.getBalance(user2);

      // Now unstake half of the shares
      const userShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;

      const unstakeSharesAmount = userShares / 2n;

      const tx = await vanaPoolStaking
        .connect(user2)
        .unstake(1, unstakeSharesAmount, 0);
      const receipt = await getReceipt(tx);

      await tx.should.emit(vanaPoolStaking, "Unstaked");

      // Verify user's balance increased (excluding gas costs)
      const user2BalanceAfter = await ethers.provider.getBalance(user2);
      user2BalanceAfter.should.gt(user2BalanceBefore - receipt.fee);

      // Verify user's remaining shares
      const remainingShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      remainingShares.should.lt(userShares);
    });

    it("should reject unstake with zero amount", async function () {
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(1) });
      await vanaPoolStaking
        .connect(user2)
        .unstake(1, 0, 0)
        .should.rejectedWith("InvalidAmount()");
    });

    it("should reject unstake for stakes user doesn't own", async function () {
      await vanaPoolStaking
        .connect(user2)
        .unstake(1, parseEther(1), 0)
        .should.rejectedWith("InvalidAmount()");
    });

    it("should reject unstake with invalid slippage", async function () {
      // First stake some VANA
      const stakeAmount = parseEther(2);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Get user shares
      const userShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      const unstakeSharesAmount = userShares / 2n;

      // Set minimum VANA amount too high
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const expectedVanaAmount =
        (shareToVana * unstakeSharesAmount) / parseEther(1);
      const tooHighMinAmount = expectedVanaAmount * BigInt(2); // 200% of expected amount

      await vanaPoolStaking
        .connect(user2)
        .unstake(1, unstakeSharesAmount, tooHighMinAmount)
        .should.rejectedWith("InvalidSlippage()");
    });

    it("should handle share to VANA conversion", async function () {
      // Initial stake from user2
      const stakeAmount = parseEther(1);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Add some rewards to change the share/VANA ratio
      await vanaPoolEntity
        .connect(user3)
        .addRewards(1, { value: parseEther(0.5) });

      // Process rewards to move to active pool
      await vanaPoolEntity.processRewards(1);

      // Fast forward time for rewards to accrue
      await helpers.time.increase(86400 * 30); // 30 days

      // Process rewards again
      await vanaPoolEntity.processRewards(1);

      // User3 stakes VANA after rewards have accrued
      const stakeAmount2 = parseEther(1);
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, 0, { value: stakeAmount2 });

      // Verify user received shares
      const userShares = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;
      userShares.should.gt(0n);
    });
  });

  describe("Rewards", () => {
    beforeEach(async () => {
      await deploy();

      // Create an entity for testing rewards
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: minRegistrationStake },
      );
    });

    it("should add rewards to an entity successfully", async function () {
      const rewardAmount = parseEther(1);
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      const entityBefore = await vanaPoolEntity.entities(1);

      const tx = await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: rewardAmount });

      await tx.should
        .emit(vanaPoolEntity, "RewardsAdded")
        .withArgs(1, rewardAmount);

      // Verify treasury received funds
      const treasuryBalanceAfter = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      treasuryBalanceAfter.should.eq(treasuryBalanceBefore + rewardAmount);

      // Verify entity locked rewards increased
      const entityAfter = await vanaPoolEntity.entities(1);
      entityAfter.lockedRewardPool.should.eq(
        entityBefore.lockedRewardPool + rewardAmount,
      );
    });

    it("should reject adding zero rewards", async function () {
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: 0 })
        .should.rejectedWith("InvalidParam()");
    });

    it("should process rewards correctly", async function () {
      // Add rewards
      const rewardAmount = parseEther(1);
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: rewardAmount });

      const entityBefore = await vanaPoolEntity.entities(1);

      // Fast forward time to accrue rewards
      await helpers.time.increase(86400); // 1 day

      // Process rewards
      const tx = await vanaPoolEntity.processRewards(1);

      await tx.should.emit(vanaPoolEntity, "RewardsProcessed");

      const entityAfter = await vanaPoolEntity.entities(1);

      // Some reward should have been moved from locked to active pool
      entityAfter.lockedRewardPool.should.lt(entityBefore.lockedRewardPool);
      entityAfter.activeRewardPool.should.gt(entityBefore.activeRewardPool);

      // Last update timestamp should be updated
      entityAfter.lastUpdateTimestamp.should.gt(
        entityBefore.lastUpdateTimestamp,
      );
    });

    it("should update entity maxAPY", async function () {
      const newMaxAPY = parseEther(12); // 12% APY

      // Add rewards
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: parseEther(1) });

      // Update maxAPY
      const tx = await vanaPoolEntity
        .connect(maintainer)
        .updateEntityMaxAPY(1, newMaxAPY);

      await tx.should
        .emit(vanaPoolEntity, "EntityMaxAPYUpdated")
        .withArgs(1, newMaxAPY);

      const entity = await vanaPoolEntity.entities(1);
      entity.maxAPY.should.eq(newMaxAPY);
    });

    it("should reject updateEntityMaxAPY when non-maintainer", async function () {
      await vanaPoolEntity
        .connect(user1)
        .updateEntityMaxAPY(1, parseEther(12))
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should use rewards to increase share value", async function () {
      // User2 makes initial stake
      const initialStake = parseEther(5);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: initialStake });

      // Add rewards
      const rewardAmount = parseEther(2.5); // 50% of staked amount
      await vanaPoolEntity
        .connect(user3)
        .addRewards(1, { value: rewardAmount });

      // Fast forward time
      await helpers.time.increase(86400 * 30); // 30 days

      // Process rewards
      await vanaPoolEntity.processRewards(1);

      // User3 stakes after rewards were processed
      const laterStake = parseEther(5);
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, 0, { value: laterStake });

      // User2 and user3 staked the same amount of VANA
      // User3 should have received fewer shares reflecting the new share/VANA ratio
      const user2Shares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      const user3Shares = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;

      // Both users should have shares
      user2Shares.should.gt(0n);
      user3Shares.should.gt(0n);

      // User3 should have fewer shares since the share value increased
      user3Shares.should.lt(user2Shares);
    });

    it("should handle multiple reward additions and processing", async function () {
      // User2 makes initial stake
      const initialStake = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: initialStake });

      // Add first batch of rewards
      const firstReward = parseEther(1);
      await vanaPoolEntity.connect(user3).addRewards(1, { value: firstReward });

      // Fast forward 10 days
      await helpers.time.increase(86400 * 10);

      // Process rewards
      await vanaPoolEntity.processRewards(1);

      // Add second batch of rewards
      const secondReward = parseEther(2);
      await vanaPoolEntity
        .connect(user3)
        .addRewards(1, { value: secondReward });

      // Fast forward another 10 days
      await helpers.time.increase(86400 * 10);

      // Process rewards again
      await vanaPoolEntity.processRewards(1);

      // Get entity info
      const entity = await vanaPoolEntity.entities(1);

      // Verify that some rewards have been processed
      entity.activeRewardPool.should.gt(initialStake);
      entity.lockedRewardPool.should.lt(firstReward + secondReward);
    });

    it("should process all rewards if time period is long enough", async function () {
      // Add a small amount of rewards
      const rewardAmount = parseEther(0.1);
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: rewardAmount });

      // Fast forward a very long time
      await helpers.time.increase(86400 * 365); // 1 year

      // Process rewards
      await vanaPoolEntity.processRewards(1);

      // Get entity info
      const entity = await vanaPoolEntity.entities(1);

      // Verify that all or most rewards have been processed
      entity.lockedRewardPool.should.lt(parseEther(0.01)); // Less than 10% remaining
    });

    it("should reject reward operations for non-existent entities", async function () {
      const nonExistentEntityId = 999;

      // Try to add rewards to non-existent entity
      await vanaPoolEntity
        .connect(user2)
        .addRewards(nonExistentEntityId, { value: parseEther(1) })
        .should.rejectedWith("InvalidEntityStatus()");

      // Try to process rewards for non-existent entity
      await vanaPoolEntity
        .connect(user2)
        .processRewards(nonExistentEntityId)
        .should.rejectedWith("InvalidEntityStatus()");
    });
  });

  describe("Complex Scenarios", () => {
    beforeEach(async () => {
      await deploy();

      // Create an entity for testing
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: minRegistrationStake },
      );
    });

    it("should handle multiple entities with stakers and rewards", async function () {
      // Create a second entity
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user2.address,
          name: "Entity Beta",
        },
        { value: minRegistrationStake },
      );

      // Set different APYs for the entities
      await vanaPoolEntity
        .connect(maintainer)
        .updateEntityMaxAPY(1, parseEther(8)); // 8% APY
      await vanaPoolEntity
        .connect(maintainer)
        .updateEntityMaxAPY(2, parseEther(12)); // 12% APY

      // Multiple users stake in both entities
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, 0, { value: parseEther(3) });
      await vanaPoolStaking
        .connect(user3)
        .stake(2, user3.address, 0, { value: parseEther(2) });
      await vanaPoolStaking
        .connect(user4)
        .stake(1, user4.address, 0, { value: parseEther(1) });
      await vanaPoolStaking
        .connect(user4)
        .stake(2, user4.address, 0, { value: parseEther(4) });

      // Add different reward amounts to each entity
      await vanaPoolEntity
        .connect(user5)
        .addRewards(1, { value: parseEther(0.5) });
      await vanaPoolEntity
        .connect(user5)
        .addRewards(2, { value: parseEther(0.8) });

      // Fast forward time
      await helpers.time.increase(86400 * 15); // 15 days

      // Process rewards for both entities
      await vanaPoolEntity.processRewards(1);
      await vanaPoolEntity.processRewards(2);

      // Verify entity stats
      const entity1 = await vanaPoolEntity.entities(1);
      const entity2 = await vanaPoolEntity.entities(2);

      // Each entity should have some rewards distributed
      entity1.lockedRewardPool.should.lt(parseEther(0.5));
      entity2.lockedRewardPool.should.lt(parseEther(0.8));

      // Calculate user3's shares in entity 1
      const user3Shares1 = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;

      // For entity 1, unstake half of user3's shares
      const halfUser3Shares1 = user3Shares1 / 2n;

      // Calculate expected VANA amount for slippage check
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const expectedVanaAmount =
        (shareToVana * halfUser3Shares1) / parseEther(1);
      const minVanaAmount = (expectedVanaAmount * BigInt(95)) / BigInt(100); // 95% of expected

      await vanaPoolStaking
        .connect(user3)
        .unstake(1, halfUser3Shares1, minVanaAmount);

      // Verify that user3 still has some shares left
      (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares.should.closeTo(user3Shares1 - halfUser3Shares1, 10n);

      // User4 has shares in entity 2
      const user4Shares2 = (
        await vanaPoolStaking.stakerEntities(user4.address, 2)
      ).shares;
      user4Shares2.should.gt(0n);
    });

    it("should handle share/VANA conversions with rewards accrual", async function () {
      // Initial stake by user2
      const stakeAmount = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Record initial shares
      const initialShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;

      // Add rewards
      await vanaPoolEntity
        .connect(user3)
        .addRewards(1, { value: parseEther(2) });

      // Fast forward time
      await helpers.time.increase(86400 * 10); // 10 days

      // Process rewards
      await vanaPoolEntity.processRewards(1);

      // User3 stakes the same amount
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, 0, { value: stakeAmount });

      // Record user3's shares
      const user3Shares = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;

      // User2 unstakes half their shares
      const halfShares = initialShares / 2n;

      // Calculate expected VANA amount for slippage check
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const expectedVanaAmount = (shareToVana * halfShares) / parseEther(1);
      const minVanaAmount = (expectedVanaAmount * BigInt(95)) / BigInt(100); // 95% of expected

      await vanaPoolStaking
        .connect(user2)
        .unstake(1, halfShares, minVanaAmount);

      // Verify user3 received shares and user2 was able to unstake
      user3Shares.should.gt(0n);
      (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares.should.closeTo(initialShares - halfShares, 10n);
    });

    it("should handle stake and unstake with slippage protection", async function () {
      // Initial stake to create baseline
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(5) });

      // Add rewards and process to change share ratio
      await vanaPoolEntity
        .connect(user3)
        .addRewards(1, { value: parseEther(1) });

      await helpers.time.increase(86400 * 5); // 5 days
      await vanaPoolEntity.processRewards(1);

      // Get current share price
      const vanaToShare = await vanaPoolEntity.vanaToEntityShare(1);
      const stakeAmount = parseEther(2);
      const expectedShares = (vanaToShare * stakeAmount) / parseEther(1);

      // Stake with slippage protection (95% of expected shares)
      const minShares = (expectedShares * BigInt(95)) / BigInt(100);

      await vanaPoolStaking
        .connect(user4)
        .stake(1, user4.address, minShares, { value: stakeAmount });

      // Verify received at least the minimum shares
      const actualShares = (
        await vanaPoolStaking.stakerEntities(user4.address, 1)
      ).shares;

      actualShares.should.gte(minShares);

      // Now test unstaking with slippage protection
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const expectedVanaAmount = (shareToVana * actualShares) / parseEther(1);
      const minVanaAmount = (expectedVanaAmount * BigInt(95)) / BigInt(100);

      // Unstake all shares
      await vanaPoolStaking
        .connect(user4)
        .unstake(1, actualShares, minVanaAmount);

      // Verify user4 has no more shares
      const remainingShares = (
        await vanaPoolStaking.stakerEntities(user4.address, 1)
      ).shares;

      remainingShares.should.eq(0n);
    });
  });

  describe("Treasury Operations", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should receive VANA in treasury", async function () {
      const initialBalance = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      // Send VANA directly to treasury
      const sendAmount = parseEther(1);
      await owner.sendTransaction({
        to: vanaPoolTreasury.target,
        value: sendAmount,
      });

      // Verify balance increase
      const finalBalance = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      finalBalance.should.eq(initialBalance + sendAmount);
    });

    it("should transfer VANA from treasury when authorized", async function () {
      // First send some VANA to treasury
      await owner.sendTransaction({
        to: vanaPoolTreasury.target,
        value: parseEther(5),
      });

      const initialUserBalance = await ethers.provider.getBalance(
        user5.address,
      );
      const initialTreasuryBalance = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      // Transfer VANA to user
      const transferAmount = parseEther(2);
      await vanaPoolTreasury
        .connect(owner)
        .transferVana(user5.address, transferAmount);

      // Verify balances
      const finalUserBalance = await ethers.provider.getBalance(user5.address);
      const finalTreasuryBalance = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      finalUserBalance.should.eq(initialUserBalance + transferAmount);
      finalTreasuryBalance.should.eq(initialTreasuryBalance - transferAmount);
    });

    it("should reject treasury transfer when non-admin", async function () {
      // Add funds to treasury
      await owner.sendTransaction({
        to: vanaPoolTreasury.target,
        value: parseEther(5),
      });

      // Try to transfer as non-admin
      await vanaPoolTreasury
        .connect(user1)
        .transferVana(user2.address, parseEther(1))
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
    });

    it("should reject treasury transfer when paused", async function () {
      // Add funds to treasury
      await owner.sendTransaction({
        to: vanaPoolTreasury.target,
        value: parseEther(5),
      });

      // Pause the treasury
      await vanaPoolTreasury.connect(owner).pause();

      // Try to transfer when paused
      await vanaPoolTreasury
        .connect(owner)
        .transferVana(user2.address, parseEther(1))
        .should.rejectedWith("EnforcedPause()");
    });

    it("should have enough balance to cover unstaking operations", async function () {
      // Create an entity
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Treasury Test Entity",
        },
        { value: minRegistrationStake },
      );

      // User stakes
      const stakeAmount = parseEther(3);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Verify treasury balance increased
      const treasuryBalance = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      treasuryBalance.should.gte(stakeAmount);

      // User unstakes half
      const userShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      const halfShares = userShares / 2n;

      // Calculate expected VANA amount for slippage check
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const expectedVanaAmount = (shareToVana * halfShares) / parseEther(1);
      const minVanaAmount = (expectedVanaAmount * BigInt(95)) / BigInt(100); // 95% of expected

      // Unstake should succeed as treasury has enough balance
      await vanaPoolStaking.connect(user2).unstake(1, halfShares, minVanaAmount)
        .should.not.be.rejected;
    });
  });

  describe("Continuous Compounding Yield", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should correctly calculate continuous compounding yield", async function () {
      // Test with 6% APY for 1 year on 1 VANA
      const apy = parseEther(6); // 6%
      const principal = parseEther(1); // 1 VANA
      const timeInSeconds = 365 * 24 * 60 * 60; // 1 year in seconds

      const compoundedYield =
        await vanaPoolEntity.calculateContinuousCompoundingYield(
          apy,
          principal,
          timeInSeconds,
        );

      // For 6% continuous compounding over 1 year, we expect approximately 0.06184 VANA
      // e^(0.06) - 1 ≈ 0.06184
      const expectedYield = parseEther(0.06184);
      compoundedYield.should.closeTo(expectedYield, parseEther(0.001)); // Allow for small rounding differences
    });

    it("should calculate entity APY correctly", async function () {
      // Create an entity for testing
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "APY Test Entity",
        },
        { value: minRegistrationStake },
      );

      // Set entity APY to 12%
      const entityId = 1;
      const maxAPY = parseEther(12);
      await vanaPoolEntity
        .connect(maintainer)
        .updateEntityMaxAPY(entityId, maxAPY);

      // Calculate the continuous APY
      const continuousAPY =
        await vanaPoolEntity.calculateContinuousAPYByEntity(entityId);

      // For 12% rate, continuous APY should be approximately 12.75%
      // (e^0.12 - 1) * 100 ≈ 12.75
      const expectedContinuousAPY = parseEther(12.75);
      continuousAPY.should.closeTo(expectedContinuousAPY, parseEther(0.1));
    });

    it("should accumulate rewards correctly over time", async function () {
      // Create an entity for testing
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Rewards Entity",
        },
        { value: minRegistrationStake },
      );

      // Add rewards
      const rewardAmount = parseEther(10);
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: rewardAmount });

      // Fast forward time - 30 days
      await helpers.time.increase(30 * 24 * 60 * 60);

      // Process rewards
      await vanaPoolEntity.processRewards(1);

      // Check entity after rewards processing
      const entity = await vanaPoolEntity.entities(1);

      // With 6% APY over 30 days, we expect approximately 0.5% yield on the active reward pool
      const startingPool = minRegistrationStake;
      const expectedYield = (startingPool * BigInt(5)) / BigInt(1000); // Approximately 0.5%

      // Verify active reward pool increased and locked reward pool decreased
      entity.activeRewardPool.should.gt(startingPool);
      entity.lockedRewardPool.should.lt(rewardAmount);

      // Check if active reward pool increase is in the expected range
      const poolIncrease = entity.activeRewardPool - startingPool;
      poolIncrease.should.gt(0);
    });

    it("should cap rewards by available locked rewards", async function () {
      // Create an entity with a very high APY
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "High APY Entity",
        },
        { value: minRegistrationStake },
      );

      // Set a very high APY - 100%
      await vanaPoolEntity
        .connect(maintainer)
        .updateEntityMaxAPY(1, parseEther(100));

      // Add small rewards
      const smallRewardAmount = parseEther(0.1);
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: smallRewardAmount });

      // Fast forward a long time
      await helpers.time.increase(365 * 24 * 60 * 60); // 1 year

      // Get entity before processing
      const entityBefore = await vanaPoolEntity.entities(1);

      // Process rewards
      await vanaPoolEntity.processRewards(1);

      // Get entity after processing
      const entityAfter = await vanaPoolEntity.entities(1);

      // Theoretical yield at 100% would be more than the reward, but should be capped
      entityAfter.lockedRewardPool.should.eq(0); // All rewards processed
      entityAfter.activeRewardPool.should.eq(
        entityBefore.activeRewardPool + smallRewardAmount,
      );
    });
  });

  describe("Entity Name Validation", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should validate entity names correctly", async function () {
      // Valid names
      const validNames = [
        "Test Entity",
        "Valid Entity Name 123",
        "Another-Valid_Name",
        "1234 Entity",
      ];

      // Create entities with valid names
      for (let i = 0; i < validNames.length; i++) {
        const entityInfo = {
          ownerAddress: user1.address,
          name: validNames[i],
        };

        await vanaPoolEntity
          .connect(maintainer)
          .createEntity(entityInfo, { value: minRegistrationStake });

        // Check that the entity was created with the correct name
        const entityId = i + 1;
        const entity = await vanaPoolEntity.entities(entityId);
        entity.name.should.eq(validNames[i]);
      }

      // Invalid names (too short)
      const invalidNames = [
        "A", // 1 character
        "AB", // 2 characters
        "ABC", // 3 characters
        "    ", // All spaces
      ];

      // Try to create entities with invalid names
      for (const invalidName of invalidNames) {
        const entityInfo = {
          ownerAddress: user1.address,
          name: invalidName,
        };

        await vanaPoolEntity
          .connect(maintainer)
          .createEntity(entityInfo, { value: minRegistrationStake })
          .should.rejectedWith("InvalidName()");
      }
    });
  });

  describe("Security and Role Management", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should enforce role-based access control", async function () {
      // Try to call maintainer functions as a regular user
      await vanaPoolEntity
        .connect(user1)
        .pause()
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      await vanaPoolEntity
        .connect(user1)
        .updateMinRegistrationStake(parseEther(2))
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      await vanaPoolStaking
        .connect(user1)
        .updateMinStakeAmount(parseEther(0.2))
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should properly revoke and grant roles", async function () {
      // Grant maintainer role to user3
      await vanaPoolEntity
        .connect(owner)
        .grantRole(MAINTAINER_ROLE, user3.address);

      // Verify user3 now has the role
      (await vanaPoolEntity.hasRole(MAINTAINER_ROLE, user3.address)).should.eq(
        true,
      );

      // User3 should now be able to call maintainer functions
      await vanaPoolEntity
        .connect(user3)
        .updateMinRegistrationStake(parseEther(2)).should.not.be.rejected;

      // Revoke the role
      await vanaPoolEntity
        .connect(owner)
        .revokeRole(MAINTAINER_ROLE, user3.address);

      // Verify user3 no longer has the role
      (await vanaPoolEntity.hasRole(MAINTAINER_ROLE, user3.address)).should.eq(
        false,
      );

      // User3 should no longer be able to call maintainer functions
      await vanaPoolEntity
        .connect(user3)
        .updateMinRegistrationStake(parseEther(3))
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user3.address}", "${MAINTAINER_ROLE}")`,
        );
    });
  });

  describe("Contract Interactions", () => {
    beforeEach(async () => {
      await deploy();

      // Create an entity for testing
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: minRegistrationStake },
      );
    });

    it("should correctly update references between contracts", async function () {
      // Deploy a new VanaPoolStaking implementation
      const vanaPoolStakingDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaPoolStakingImplementation"),
        [trustedForwarder.address, owner.address, minStakeAmount],
        {
          kind: "uups",
        },
      );

      const newVanaPoolStaking = await ethers.getContractAt(
        "VanaPoolStakingImplementation",
        vanaPoolStakingDeploy.target,
      );

      // Update VanaPoolEntity to use the new VanaPoolStaking
      await vanaPoolEntity
        .connect(maintainer)
        .updateVanaPool(newVanaPoolStaking.target);

      // Verify the update worked
      (await vanaPoolEntity.vanaPoolStaking()).should.eq(
        newVanaPoolStaking.target,
      );

      // Verify roles were properly assigned
      (
        await vanaPoolEntity.hasRole(VANA_POOL_ROLE, vanaPoolStaking.target)
      ).should.eq(false);
      (
        await vanaPoolEntity.hasRole(VANA_POOL_ROLE, newVanaPoolStaking.target)
      ).should.eq(true);
    });

    it("should handle treasury updates correctly", async function () {
      // Deploy a new VanaPoolTreasury
      const treasuryDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaPoolTreasuryImplementation"),
        [owner.address, vanaPoolStaking.target],
        {
          kind: "uups",
        },
      );

      const newVanaPoolTreasury = await ethers.getContractAt(
        "VanaPoolTreasuryImplementation",
        treasuryDeploy.target,
      );

      // Update the staking contract to use the new treasury
      await vanaPoolStaking
        .connect(maintainer)
        .updateVanaPoolTreasury(newVanaPoolTreasury.target);

      // Verify the update worked
      (await vanaPoolStaking.vanaPoolTreasury()).should.eq(
        newVanaPoolTreasury.target,
      );

      // Try operations with the new treasury
      // First fund the treasury
      await owner.sendTransaction({
        to: newVanaPoolTreasury.target,
        value: parseEther(5),
      });

      // Stake should work with new treasury
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, 0, { value: parseEther(1) }).should.not.be
        .rejected;
    });

    it("should test", async function () {
      console.log(await vanaPoolEntity._calculateExponential(parseEther(2)));
    });
  });
});
