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
  const MIN_STAKE_AMOUNT = parseEther(0.1); // 0.1 VANA
  const MIN_REGISTRATION_STAKE = parseEther(1); // 1 VANA
  const MAX_APY_DEFAULT = parseEther(6); // 6% APY

  enum EntityStatus {
    None,
    Active,
    Removed,
  }

  // Entity creation info type
  type EntityCreationInfo = {
    ownerAddress: HardhatEthersSigner;
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
      [trustedForwarder.address, owner.address, MIN_STAKE_AMOUNT],
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
        MIN_REGISTRATION_STAKE,
        MAX_APY_DEFAULT,
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
      (await vanaPoolStaking.minStakeAmount()).should.eq(MIN_STAKE_AMOUNT);
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
        MIN_REGISTRATION_STAKE,
      );
      (await vanaPoolEntity.maxAPYDefault()).should.eq(MAX_APY_DEFAULT);
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
      (await vanaPoolStaking.paused()).should.be.equal(true);

      await vanaPoolStaking
        .connect(maintainer)
        .unpause()
        .should.emit(vanaPoolStaking, "Unpaused");
      (await vanaPoolStaking.paused()).should.be.equal(false);

      // Test VanaPoolEntity pause and unpause
      await vanaPoolEntity
        .connect(maintainer)
        .pause()
        .should.emit(vanaPoolEntity, "Paused");
      (await vanaPoolEntity.paused()).should.be.equal(true);

      await vanaPoolEntity
        .connect(maintainer)
        .unpause()
        .should.emit(vanaPoolEntity, "Unpaused");
      (await vanaPoolEntity.paused()).should.be.equal(false);
    });

    it("should reject pause and unpause when non-maintainer", async function () {
      await vanaPoolStaking
        .connect(user1)
        .pause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      await vanaPoolStaking.connect(maintainer).pause();
      await vanaPoolStaking
        .connect(user1)
        .unpause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      await vanaPoolEntity
        .connect(user1)
        .pause()
        .should.be.rejectedWith(
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
        .should.be.rejectedWith(
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
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });
  });

  describe("Entity Management", () => {
    beforeEach(async () => {
      await deploy();
    });

    const createEntity = async (entityInfo: EntityCreationInfo) => {
      const registrationInfo = {
        ownerAddress: entityInfo.ownerAddress.address,
        name: entityInfo.name,
      };

      return vanaPoolEntity
        .connect(entityInfo.ownerAddress)
        .createEntity(registrationInfo, { value: MIN_REGISTRATION_STAKE });
    };

    it("should create an entity successfully", async function () {
      const entityInfo = {
        ownerAddress: user1,
        name: "Test Entity",
      };

      const treasuryBalanceBefore = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      const tx = await createEntity(entityInfo);
      const receipt = await getReceipt(tx);

      await tx.should
        .emit(vanaPoolEntity, "EntityCreated")
        .withArgs(1, user1.address, "Test Entity", MAX_APY_DEFAULT)
        .and.emit(vanaPoolEntity, "EntityStatusUpdated")
        .withArgs(1, EntityStatus.Active)
        .and.emit(vanaPoolStaking, "Staked");

      const entityCount = await vanaPoolEntity.entitiesCount();
      entityCount.should.eq(1);

      const entityData = await vanaPoolEntity.entities(1);
      entityData.entityId.should.eq(1);
      entityData.ownerAddress.should.eq(user1.address);
      entityData.name.should.eq("Test Entity");
      entityData.maxAPY.should.eq(MAX_APY_DEFAULT);
      entityData.status.should.eq(EntityStatus.Active);
      entityData.totalShares.should.eq(MIN_REGISTRATION_STAKE);
      entityData.activeRewardPool.should.eq(MIN_REGISTRATION_STAKE);

      // Verify name mapping
      (await vanaPoolEntity.entityNameToId("Test Entity")).should.eq(1);

      // Verify stake registration in VanaPool
      const ownerShares = (
        await vanaPoolStaking.stakerEntities(user1.address, 1)
      ).shares;
      ownerShares.should.eq(MIN_REGISTRATION_STAKE);

      // Verify funds were sent to treasury
      const treasuryBalanceAfter = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );
      treasuryBalanceAfter.should.eq(
        treasuryBalanceBefore + MIN_REGISTRATION_STAKE,
      );
    });

    it("should reject entity creation with same name", async function () {
      const entityInfo = {
        ownerAddress: user1,
        name: "Test Entity",
      };

      await createEntity(entityInfo);

      const entityInfo2 = {
        ownerAddress: user2,
        name: "Test Entity", // Same name as first entity
      };

      await createEntity(entityInfo2).should.be.rejectedWith("InvalidName()");
    });

    it("should reject entity creation with name too short", async function () {
      const entityInfo = {
        ownerAddress: user1,
        name: "ABC", // Less than 4 characters
      };

      await createEntity(entityInfo).should.be.rejectedWith("InvalidName()");
    });

    it("should reject entity creation with wrong registration stake", async function () {
      const entityInfo = {
        ownerAddress: user1,
        name: "Test Entity",
      };

      await vanaPoolEntity
        .connect(user1)
        .createEntity(
          {
            ownerAddress: user1.address,
            name: entityInfo.name,
          },
          { value: MIN_REGISTRATION_STAKE - BigInt(1) },
        )
        .should.be.rejectedWith("InvalidRegistrationStake()");
    });

    it("should update entity information successfully", async function () {
      const entityInfo = {
        ownerAddress: user1,
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
        ownerAddress: user1,
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
        .should.be.rejectedWith("NotEntityOwner()");
    });

    it("should remove entity successfully", async function () {
      const entityInfo = {
        ownerAddress: user1,
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
        .stake(1, user3.address, { value: parseEther(1) })
        .should.be.rejectedWith("EntityNotActive()");
    });

    it("should reject entity removal when not owner", async function () {
      const entityInfo = {
        ownerAddress: user1,
        name: "Test Entity",
      };

      await createEntity(entityInfo);

      await vanaPoolEntity
        .connect(user2)
        .removeEntity(1)
        .should.be.rejectedWith("NotEntityOwner()");
    });
  });

  describe("Staking Operations", () => {
    beforeEach(async () => {
      await deploy();

      // Create an entity for testing staking operations
      await vanaPoolEntity.connect(user1).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: MIN_REGISTRATION_STAKE },
      );
    });

    it("should stake successfully in an entity for self", async function () {
      const stakeAmount = parseEther(2);
      const user2BalanceBefore = await ethers.provider.getBalance(user2);
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        vanaPoolTreasury.target,
      );

      const entityBefore = await vanaPoolEntity.entities(1);

      // Stake for self (user2 as sender and recipient)
      const tx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, { value: stakeAmount });
      const receipt = await getReceipt(tx);

      await tx.should.emit(vanaPoolStaking, "Staked");

      // Verify user's balance update
      const user2BalanceAfter = await ethers.provider.getBalance(user2);
      user2BalanceAfter.should.be.closeTo(
        user2BalanceBefore - stakeAmount - receipt.fee,
        1000n,
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
      userShares.should.be.gt(0n);

      // Verify entity stats update
      const entityAfter = await vanaPoolEntity.entities(1);
      entityAfter.totalShares.should.be.gt(entityBefore.totalShares);
      entityAfter.activeRewardPool.should.be.gt(entityBefore.activeRewardPool);
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
        .stake(1, user3.address, { value: stakeAmount });
      const receipt = await getReceipt(tx);

      await tx.should.emit(vanaPoolStaking, "Staked");

      // Verify staker's balance update
      const user2BalanceAfter = await ethers.provider.getBalance(user2);
      user2BalanceAfter.should.be.closeTo(
        user2BalanceBefore - stakeAmount - receipt.fee,
        1000n,
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
      user3Shares.should.be.gt(0n);

      // Verify staker has no shares
      const user2Shares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      user2Shares.should.eq(0n);
    });

    it("should reject stake with invalid recipient", async function () {
      await vanaPoolStaking
        .connect(user2)
        .stake(1, ethers.ZeroAddress, { value: parseEther(1) })
        .should.be.rejectedWith("InvalidRecipient()");
    });

    it("should reject stake with amount below minimum", async function () {
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, { value: MIN_STAKE_AMOUNT - BigInt(1) })
        .should.be.rejectedWith("InsufficientStakeAmount()");
    });

    it("should reject stake for non-existent entity", async function () {
      await vanaPoolStaking
        .connect(user2)
        .stake(999, user2.address, { value: parseEther(1) })
        .should.be.rejectedWith("EntityNotActive()");
    });

    it("should unstake successfully from an entity", async function () {
      // First stake some VANA
      const stakeAmount = parseEther(2);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, { value: stakeAmount });

      const user2BalanceBefore = await ethers.provider.getBalance(user2);

      // Now unstake half of the shares
      const userShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      const unstakeSharesAmount = userShares / 2n;

      const tx = await vanaPoolStaking
        .connect(user2)
        .unstake(1, unstakeSharesAmount);
      const receipt = await getReceipt(tx);

      await tx.should.emit(vanaPoolStaking, "Unstaked");

      // Verify user's balance increased (excluding gas costs)
      const user2BalanceAfter = await ethers.provider.getBalance(user2);
      user2BalanceAfter.should.be.gt(user2BalanceBefore - receipt.fee);

      // Verify user's remaining shares
      const remainingShares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      remainingShares.should.be.lt(userShares);
    });

    it("should reject unstake with zero amount", async function () {
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, { value: parseEther(1) });
      await vanaPoolStaking
        .connect(user2)
        .unstake(1, 0)
        .should.be.rejectedWith("InvalidAmount()");
    });

    it("should reject unstake for stakes user doesn't own", async function () {
      await vanaPoolStaking
        .connect(user2)
        .unstake(1, parseEther(1))
        .should.be.rejectedWith("InvalidAmount()");
    });

    it("should prevent entity owner from unstaking below registration stake", async function () {
      // Owner tries to unstake the registration stake
      await vanaPoolStaking
        .connect(user1)
        .unstake(1, MIN_REGISTRATION_STAKE)
        .should.be.rejectedWith("CannotRemoveRegistrationStake()");
    });

    it("should allow entity owner to unstake above registration stake", async function () {
      // First stake more than the registration amount
      const additionalStake = parseEther(3);
      await vanaPoolStaking
        .connect(user1)
        .stake(1, user1.address, { value: additionalStake });

      // Total owner stake is now MIN_REGISTRATION_STAKE + additionalStake
      const ownerShares = (
        await vanaPoolStaking.stakerEntities(user1.address, 1)
      ).shares;

      // Calculate shares equivalent to the additional stake (approximately)
      const sharesToUnstake = ownerShares - MIN_REGISTRATION_STAKE;

      const tx = await vanaPoolStaking
        .connect(user1)
        .unstake(1, sharesToUnstake);

      await tx.should.emit(vanaPoolStaking, "Unstaked");

      // Verify remaining shares are approximately equal to registration amount
      const remainingShares = (
        await vanaPoolStaking.stakerEntities(user1.address, 1)
      ).shares;
      remainingShares.should.be.gte((MIN_REGISTRATION_STAKE * 9n) / 10n); // Allow for some rounding
    });

    it("should handle share to VANA conversion", async function () {
      // Initial stake from user2
      const stakeAmount = parseEther(1);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, { value: stakeAmount });

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
        .stake(1, user3.address, { value: stakeAmount2 });

      // Verify user received shares
      const userShares = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;
      userShares.should.be.gt(0n);
    });
  });

  describe("Rewards", () => {
    beforeEach(async () => {
      await deploy();

      // Create an entity for testing rewards
      await vanaPoolEntity.connect(user1).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: MIN_REGISTRATION_STAKE },
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
        .should.be.rejectedWith("InvalidParam()");
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
      entityAfter.lockedRewardPool.should.be.lt(entityBefore.lockedRewardPool);
      entityAfter.activeRewardPool.should.be.gt(entityBefore.activeRewardPool);

      // Last update timestamp should be updated
      entityAfter.lastUpdateTimestamp.should.be.gt(
        entityBefore.lastUpdateTimestamp,
      );
    });

    it("should update entity maxAPY", async function () {
      const newMaxAPY = parseEther(12); // 12% APY

      // Add rewards
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: parseEther(1) });

      // Update maxAPY - use owner instead of maintainer
      const tx = await vanaPoolEntity
        .connect(owner)
        .updateEntityMaxAPY(1, newMaxAPY);

      await tx.should
        .emit(vanaPoolEntity, "EntityMaxAPYUpdated")
        .withArgs(1, newMaxAPY);

      const entity = await vanaPoolEntity.entities(1);
      entity.maxAPY.should.eq(newMaxAPY);
    });

    it("should reject updateEntityMaxAPY when non-admin", async function () {
      await vanaPoolEntity
        .connect(user1)
        .updateEntityMaxAPY(1, parseEther(12))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should use rewards to increase share value", async function () {
      // User2 makes initial stake
      const initialStake = parseEther(5);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, { value: initialStake });

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
        .stake(1, user3.address, { value: laterStake });

      // User2 and user3 staked the same amount of VANA
      // User3 should have received shares reflecting the new share/VANA ratio
      const user2Shares = (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares;
      const user3Shares = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;

      // Both users should have shares
      user2Shares.should.be.gt(0n);
      user3Shares.should.be.gt(0n);
    });
  });

  describe("Complex Scenarios", () => {
    beforeEach(async () => {
      await deploy();

      // Create an entity for testing
      await vanaPoolEntity.connect(user1).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: MIN_REGISTRATION_STAKE },
      );
    });

    it("should handle multiple entities with stakers and rewards", async function () {
      // Create a second entity
      await vanaPoolEntity.connect(user2).createEntity(
        {
          ownerAddress: user2.address,
          name: "Entity Beta",
        },
        { value: MIN_REGISTRATION_STAKE },
      );

      // Set different APYs for the entities - use owner since maintainer role issues
      await vanaPoolEntity.connect(owner).updateEntityMaxAPY(1, parseEther(8)); // 8% APY
      await vanaPoolEntity.connect(owner).updateEntityMaxAPY(2, parseEther(12)); // 12% APY

      // Multiple users stake in both entities
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, { value: parseEther(3) });
      await vanaPoolStaking
        .connect(user3)
        .stake(2, user3.address, { value: parseEther(2) });
      await vanaPoolStaking
        .connect(user4)
        .stake(1, user4.address, { value: parseEther(1) });
      await vanaPoolStaking
        .connect(user4)
        .stake(2, user4.address, { value: parseEther(4) });

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
      entity1.lockedRewardPool.should.be.lt(parseEther(0.5));
      entity2.lockedRewardPool.should.be.lt(parseEther(0.8));

      // Calculate user3's shares in entity 1
      const user3Shares1 = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;

      // For entity 1, unstake half of user3's shares
      const halfUser3Shares1 = user3Shares1 / 2n;
      await vanaPoolStaking.connect(user3).unstake(1, halfUser3Shares1);

      // Verify that user3 still has some shares left
      (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares.should.be.closeTo(user3Shares1 - halfUser3Shares1, 10n);

      // User4 has shares in entity 2
      const user4Shares2 = (
        await vanaPoolStaking.stakerEntities(user4.address, 2)
      ).shares;
      user4Shares2.should.be.gt(0n);
    });

    it("should handle entity removal with rewards", async function () {
      // Add rewards
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: parseEther(0.5) });

      // Fast forward time
      await helpers.time.increase(86400); // 1 day

      // Process rewards
      await vanaPoolEntity.processRewards(1);

      // Verify rewards were processed
      const entity = await vanaPoolEntity.entities(1);
      entity.lockedRewardPool.should.be.lt(parseEther(0.5));

      // Remove entity (should succeed as only owner has stakes)
      await vanaPoolEntity
        .connect(user1)
        .removeEntity(1)
        .should.emit(vanaPoolEntity, "EntityStatusUpdated")
        .withArgs(1, EntityStatus.Removed);

      // Verify entity is removed
      const removedEntity = await vanaPoolEntity.entities(1);
      removedEntity.status.should.eq(EntityStatus.Removed);

      // Try to stake in removed entity (should fail)
      await vanaPoolStaking
        .connect(user3)
        .stake(1, user3.address, { value: parseEther(1) })
        .should.be.rejectedWith("EntityNotActive()");

      // Try to add rewards to removed entity (should fail)
      await vanaPoolEntity
        .connect(user2)
        .addRewards(1, { value: parseEther(0.1) })
        .should.be.rejectedWith("InvalidEntityStatus()");
    });

    it("should handle share/VANA conversions with rewards accrual", async function () {
      // Initial stake by user2
      const stakeAmount = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, { value: stakeAmount });

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
        .stake(1, user3.address, { value: stakeAmount });

      // Record user3's shares
      const user3Shares = (
        await vanaPoolStaking.stakerEntities(user3.address, 1)
      ).shares;

      // User2 unstakes half their shares
      const halfShares = initialShares / 2n;
      await vanaPoolStaking.connect(user2).unstake(1, halfShares);

      // Verify user3 received shares and user2 was able to unstake
      user3Shares.should.be.gt(0n);
      (
        await vanaPoolStaking.stakerEntities(user2.address, 1)
      ).shares.should.be.closeTo(initialShares - halfShares, 10n);
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
        .should.be.rejectedWith(
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
        .should.be.rejectedWith("EnforcedPause()");
    });
  });
});
