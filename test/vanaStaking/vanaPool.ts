import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { formatEther } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {
  VanaPoolStakingImplementation,
  VanaPoolEntityImplementation,
  VanaPoolTreasuryImplementation,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../../utils/helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import {
  advanceToTimestamp,
  getCurrentBlockTimestamp,
} from "../../utils/timeAndBlockManipulation";

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
      (await vanaPoolStaking.version()).should.eq(2);
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
        .should.be.revertedWithCustomError(vanaPoolEntity, "NotEntityOwner");
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

  describe("Bonding Period", () => {
    const bondingPeriod = 5 * day; // 5 days bonding period

    beforeEach(async () => {
      await deploy();

      // Set bonding period to 5 days
      await vanaPoolStaking.connect(owner).updateBondingPeriod(bondingPeriod);

      // Create an entity for testing
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: minRegistrationStake },
      );
    });

    it("should set rewardEligibilityTimestamp on first stake", async function () {
      const stakeAmount = parseEther(2);
      const timestampBefore = await getCurrentBlockTimestamp();

      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Cost basis should equal stake amount
      stakerEntity.costBasis.should.eq(stakeAmount);

      // Shares should be issued
      stakerEntity.shares.should.gt(0n);

      // Reward eligibility timestamp should be current time + bonding period
      // (accounting for the 1 second block advancement)
      const expectedEligibility = timestampBefore + bondingPeriod + 1;
      stakerEntity.rewardEligibilityTimestamp.should.eq(expectedEligibility);
    });

    it("should calculate weighted average bonding time for second stake during bonding period", async function () {
      // First stake: 2 ETH
      const firstStake = parseEther(2);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: firstStake });

      const afterFirstStake = await getCurrentBlockTimestamp();
      const firstStakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Verify first stake state
      firstStakerEntity.costBasis.should.eq(firstStake);
      const firstEligibility = Number(firstStakerEntity.rewardEligibilityTimestamp);

      // Wait 2 days (still within bonding period)
      await helpers.time.increase(2 * day);
      const beforeSecondStake = await getCurrentBlockTimestamp();

      // Second stake: 3 ETH during bonding period
      const secondStake = parseEther(3);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: secondStake });

      const afterSecondStake = await getCurrentBlockTimestamp();
      const secondStakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Cost basis should be sum of both stakes
      secondStakerEntity.costBasis.should.eq(firstStake + secondStake);

      // Shares should increase
      secondStakerEntity.shares.should.gt(firstStakerEntity.shares);

      // Calculate expected weighted average bonding time:
      // old_remaining_time = firstEligibility - afterSecondStake = ~3 days remaining
      // new_remaining_time = (old_amount * old_remaining + new_amount * full_period) / total_amount
      // = (2 * 3 days + 3 * 5 days) / 5 = (6 + 15) / 5 = 4.2 days
      const oldRemainingTime = firstEligibility - afterSecondStake;
      const oldValue = firstStake; // At 1:1 share price, oldValue equals first stake
      const totalValue = firstStake + secondStake;
      const expectedWeightedTime = (Number(oldValue) * oldRemainingTime + Number(secondStake) * bondingPeriod) / Number(totalValue);
      const expectedNewEligibility = afterSecondStake + expectedWeightedTime;

      // Allow 1 second tolerance for block timing
      const actualEligibility = Number(secondStakerEntity.rewardEligibilityTimestamp);
      actualEligibility.should.be.closeTo(expectedNewEligibility, 2);

      // The new eligibility should be between old remaining and full bonding period from now
      actualEligibility.should.be.gt(afterSecondStake + oldRemainingTime);
      actualEligibility.should.be.lt(afterSecondStake + bondingPeriod);
    });

    it("should start fresh bonding period for second stake after bonding period ends", async function () {
      // First stake: 2 ETH
      const firstStake = parseEther(2);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: firstStake });

      const firstStakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const firstCostBasis = firstStakerEntity.costBasis;
      const firstShares = firstStakerEntity.shares;

      // Wait for bonding period to end (6 days > 5 days bonding)
      await helpers.time.increase(6 * day);
      const beforeSecondStake = await getCurrentBlockTimestamp();

      // Second stake: 3 ETH after bonding period
      const secondStake = parseEther(3);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: secondStake });

      const afterSecondStake = await getCurrentBlockTimestamp();
      const secondStakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Shares should increase
      secondStakerEntity.shares.should.gt(firstShares);

      // After bonding period ends, cost basis is reset to current total value
      // At 1:1 share price (no rewards processed), total value = first stake + second stake
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const totalShares = secondStakerEntity.shares;
      const expectedTotalValue = (totalShares * shareToVana) / parseEther(1);
      secondStakerEntity.costBasis.should.eq(expectedTotalValue);

      // New bonding period is proportional: (stakeAmount * bondingPeriod) / totalValue
      // Since stakeAmount < totalValue, the new bonding period is less than full
      const expectedNewBondingTime = (Number(secondStake) * bondingPeriod) / Number(expectedTotalValue);
      const expectedEligibility = afterSecondStake + expectedNewBondingTime;

      const actualEligibility = Number(secondStakerEntity.rewardEligibilityTimestamp);
      actualEligibility.should.be.closeTo(expectedEligibility, 2);

      // New bonding time should be less than full bonding period since it's weighted by stake ratio
      actualEligibility.should.be.lt(afterSecondStake + bondingPeriod);
      actualEligibility.should.be.gt(afterSecondStake);
    });

    it("should forfeit rewards when unstaking before reward eligibility", async function () {
      // Add rewards to the entity first
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(1) });

      // Process rewards
      await helpers.time.increase(day);
      await vanaPoolEntity.processRewards(1);

      // User2 stakes
      const stakeAmount = parseEther(2);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const costBasis = stakerEntity.costBasis;
      const shares = stakerEntity.shares;

      // Wait 2 days (still in bonding period of 5 days)
      await helpers.time.increase(2 * day);

      // Check share value - should have accrued some rewards
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const shareValue = (shares * shareToVana) / parseEther(1);

      // Share value should be >= cost basis (rewards may have accrued)
      shareValue.should.gte(costBasis);

      // Get user balance before unstake
      const balanceBefore = await ethers.provider.getBalance(user2.address);

      // Unstake during bonding period - should only get cost basis back
      const tx = await vanaPoolStaking.connect(user2).unstake(1, shares, 0);
      const receipt = await getReceipt(tx);
      const gasUsed = receipt.gasUsed * tx.gasPrice!;

      // Get user balance after unstake
      const balanceAfter = await ethers.provider.getBalance(user2.address);

      // User should receive cost basis, not full share value
      const received = balanceAfter - balanceBefore + gasUsed;

      // Should receive proportional cost basis (unstaking all shares = full cost basis)
      received.should.eq(costBasis);
    });

    it("should receive full rewards when unstaking after reward eligibility", async function () {
      // Add rewards to the entity first
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(1) });

      // Process rewards
      await helpers.time.increase(day);
      await vanaPoolEntity.processRewards(1);

      // User2 stakes
      const stakeAmount = parseEther(2);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const shares = stakerEntity.shares;

      // Wait for bonding period to end (6 days > 5 days)
      await helpers.time.increase(6 * day);

      // Process more rewards
      await vanaPoolEntity.processRewards(1);

      // Check share value after bonding
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const shareValue = (shares * shareToVana) / parseEther(1);

      // Get user balance before unstake
      const balanceBefore = await ethers.provider.getBalance(user2.address);

      // Unstake after bonding period - should get full share value
      const tx = await vanaPoolStaking.connect(user2).unstake(1, shares, 0);
      const receipt = await getReceipt(tx);
      const gasUsed = receipt.gasUsed * tx.gasPrice!;

      // Get user balance after unstake
      const balanceAfter = await ethers.provider.getBalance(user2.address);

      // User should receive full share value
      const received = balanceAfter - balanceBefore + gasUsed;

      // Should receive full share value (with small tolerance for rounding)
      const diff = received > shareValue ? received - shareValue : shareValue - received;
      diff.should.be.lt(parseEther(0.0001)); // Allow tiny rounding difference
    });

    it("should extend bonding time on partial unstake during bonding period (anti-gaming)", async function () {
      // User2 stakes 10 ETH
      const stakeAmount = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const stakerEntityAfterStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const initialEligibility = Number(stakerEntityAfterStake.rewardEligibilityTimestamp);
      const initialShares = stakerEntityAfterStake.shares;

      // Wait 2.5 days (half of 5-day bonding period)
      await helpers.time.increase(2.5 * day);
      const beforeUnstake = await getCurrentBlockTimestamp();

      // Remaining time should be ~2.5 days
      const remainingTimeBefore = initialEligibility - beforeUnstake;

      // Partial unstake: withdraw 50% of shares
      const unstakeShares = initialShares / 2n;
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);

      const afterUnstake = await getCurrentBlockTimestamp();
      const stakerEntityAfterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Shares should be reduced by half
      stakerEntityAfterUnstake.shares.should.eq(initialShares - unstakeShares);

      // Anti-gaming: new_remaining_time = old_remaining * (amount_before / amount_after)
      // = 2.5 days * (10 / 5) = 5 days (but capped at bondingPeriod = 5 days)
      const expectedExtendedTime = Math.min(
        remainingTimeBefore * 2, // 50% withdrawal doubles the time
        bondingPeriod
      );
      const expectedNewEligibility = afterUnstake + expectedExtendedTime;

      const actualNewEligibility = Number(stakerEntityAfterUnstake.rewardEligibilityTimestamp);

      // Allow small tolerance for block timing
      actualNewEligibility.should.be.closeTo(expectedNewEligibility, 3);

      // The new eligibility should be later than what it would have been without anti-gaming
      actualNewEligibility.should.be.gt(afterUnstake + remainingTimeBefore);
    });

    it("should cap extended bonding time at full bonding period", async function () {
      // User2 stakes 10 ETH
      const stakeAmount = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const stakerEntityAfterStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const initialShares = stakerEntityAfterStake.shares;

      // Wait only 1 day (4 days remaining in 5-day bonding)
      await helpers.time.increase(day);

      // Partial unstake: withdraw 90% of shares (very aggressive withdrawal)
      // This would extend time by 10x: 4 days * 10 = 40 days
      // But it should be capped at 5 days (bondingPeriod)
      const unstakeShares = (initialShares * 9n) / 10n;
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);

      const afterUnstake = await getCurrentBlockTimestamp();
      const stakerEntityAfterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // New eligibility should be capped at bondingPeriod from now
      const actualNewEligibility = Number(stakerEntityAfterUnstake.rewardEligibilityTimestamp);
      const maxEligibility = afterUnstake + bondingPeriod;

      // Should be capped at full bonding period
      actualNewEligibility.should.be.closeTo(maxEligibility, 2);
    });

    it("should not extend bonding time on full unstake", async function () {
      // User2 stakes
      const stakeAmount = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const stakerEntityAfterStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const initialShares = stakerEntityAfterStake.shares;

      // Wait 2 days
      await helpers.time.increase(2 * day);

      // Full unstake: withdraw all shares
      await vanaPoolStaking.connect(user2).unstake(1, initialShares, 0);

      const stakerEntityAfterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // All shares should be gone
      stakerEntityAfterUnstake.shares.should.eq(0n);

      // No need to check eligibility timestamp since user has no stake left
    });

    it("should not extend bonding time when unstaking after eligibility", async function () {
      // User2 stakes
      const stakeAmount = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const stakerEntityAfterStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const initialShares = stakerEntityAfterStake.shares;
      const originalEligibility = stakerEntityAfterStake.rewardEligibilityTimestamp;

      // Wait for bonding period to end (6 days > 5 days)
      await helpers.time.increase(6 * day);

      // Partial unstake after eligibility
      const unstakeShares = initialShares / 2n;
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);

      const stakerEntityAfterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Eligibility timestamp should not change (no anti-gaming needed after eligibility)
      stakerEntityAfterUnstake.rewardEligibilityTimestamp.should.eq(originalEligibility);
    });
  });

  describe("Bonding Period - Exact Number Tracking", () => {
    const bondingPeriod = 5 * day; // 5 days = 432000 seconds

    beforeEach(async () => {
      await deploy();

      // Set bonding period to 5 days
      await vanaPoolStaking.connect(owner).updateBondingPeriod(bondingPeriod);

      // Create an entity for testing
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: minRegistrationStake },
      );
    });

    it("should track exact costBasis and eligibility: single stake", async function () {
      const stakeAmount = parseEther(5);

      const tx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });
      const block = await ethers.provider.getBlock(tx.blockNumber!);
      const stakeTimestamp = block!.timestamp;

      const stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Exact values
      stakerEntity.costBasis.should.eq(stakeAmount);
      stakerEntity.shares.should.eq(stakeAmount); // 1:1 ratio initially
      stakerEntity.rewardEligibilityTimestamp.should.eq(stakeTimestamp + bondingPeriod);
    });

    it("should track exact values: stake -> partial unstake during bonding", async function () {
      // Step 1: Stake 10 ETH
      const stakeAmount = parseEther(10);
      const stakeTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });
      const stakeBlock = await ethers.provider.getBlock(stakeTx.blockNumber!);
      const stakeTimestamp = stakeBlock!.timestamp;

      const afterStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      afterStake.costBasis.should.eq(stakeAmount);
      afterStake.shares.should.eq(stakeAmount);
      afterStake.rewardEligibilityTimestamp.should.eq(stakeTimestamp + bondingPeriod);

      // Step 2: Wait 2 days (172800 seconds)
      const waitTime = 2 * day;
      await helpers.time.increase(waitTime);

      // Step 3: Unstake 4 ETH (40% of shares)
      const unstakeShares = parseEther(4);
      const unstakeTx = await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);
      const unstakeBlock = await ethers.provider.getBlock(unstakeTx.blockNumber!);
      const unstakeTimestamp = unstakeBlock!.timestamp;

      const afterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Cost basis reduced proportionally: 10 - (10 * 4 / 10) = 6 ETH
      const expectedCostBasis = stakeAmount - (stakeAmount * unstakeShares) / afterStake.shares;
      afterUnstake.costBasis.should.eq(expectedCostBasis);
      afterUnstake.costBasis.should.eq(parseEther(6));

      // Shares reduced: 10 - 4 = 6 ETH
      afterUnstake.shares.should.eq(parseEther(6));

      // Anti-gaming: remaining time before unstake
      const remainingTimeBefore = stakeTimestamp + bondingPeriod - unstakeTimestamp;
      // new_time = remaining * (before / after) = remaining * (10 / 6)
      const amountBefore = stakeAmount;
      const amountAfter = stakeAmount - unstakeShares;
      let extendedTime = (BigInt(remainingTimeBefore) * amountBefore) / amountAfter;
      // Cap at bondingPeriod
      if (extendedTime > BigInt(bondingPeriod)) {
        extendedTime = BigInt(bondingPeriod);
      }
      const expectedEligibility = BigInt(unstakeTimestamp) + extendedTime;
      afterUnstake.rewardEligibilityTimestamp.should.eq(expectedEligibility);
    });

    it("should track exact values: stake -> stake during bonding (weighted average)", async function () {
      // Step 1: Stake 6 ETH
      const firstStake = parseEther(6);
      const firstTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: firstStake });
      const firstBlock = await ethers.provider.getBlock(firstTx.blockNumber!);
      const firstTimestamp = firstBlock!.timestamp;

      const afterFirst = await vanaPoolStaking.stakerEntities(user2.address, 1);
      afterFirst.costBasis.should.eq(firstStake);
      afterFirst.rewardEligibilityTimestamp.should.eq(firstTimestamp + bondingPeriod);

      // Step 2: Wait 3 days (259200 seconds) - 2 days remaining in bonding
      const waitTime = 3 * day;
      await helpers.time.increase(waitTime);

      // Step 3: Stake 4 ETH during bonding period
      const secondStake = parseEther(4);
      const secondTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: secondStake });
      const secondBlock = await ethers.provider.getBlock(secondTx.blockNumber!);
      const secondTimestamp = secondBlock!.timestamp;

      const afterSecond = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Cost basis = first + second = 6 + 4 = 10 ETH
      afterSecond.costBasis.should.eq(firstStake + secondStake);
      afterSecond.costBasis.should.eq(parseEther(10));

      // Shares = 6 + 4 = 10 (at 1:1 ratio)
      afterSecond.shares.should.eq(parseEther(10));

      // Weighted average bonding time:
      // oldValue = 6 ETH (shares at 1:1)
      // remainingTime = (firstTimestamp + bondingPeriod) - secondTimestamp
      const oldValue = firstStake;
      const remainingTime = BigInt(firstTimestamp + bondingPeriod - secondTimestamp);
      const totalValue = firstStake + secondStake;
      // weightedTime = (oldValue * remainingTime + newStake * bondingPeriod) / totalValue
      const weightedTime = (oldValue * remainingTime + secondStake * BigInt(bondingPeriod)) / totalValue;
      const expectedEligibility = BigInt(secondTimestamp) + weightedTime;
      afterSecond.rewardEligibilityTimestamp.should.eq(expectedEligibility);
    });

    it("should track exact values: stake -> wait -> stake after bonding ends", async function () {
      // Step 1: Stake 5 ETH
      const firstStake = parseEther(5);
      const firstTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: firstStake });
      const firstBlock = await ethers.provider.getBlock(firstTx.blockNumber!);
      const firstTimestamp = firstBlock!.timestamp;

      const afterFirst = await vanaPoolStaking.stakerEntities(user2.address, 1);
      afterFirst.costBasis.should.eq(firstStake);
      afterFirst.rewardEligibilityTimestamp.should.eq(firstTimestamp + bondingPeriod);

      // Step 2: Wait 6 days (bonding period ends after 5 days)
      await helpers.time.increase(6 * day);

      // Step 3: Stake 3 ETH after bonding ended
      const secondStake = parseEther(3);
      const secondTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: secondStake });
      const secondBlock = await ethers.provider.getBlock(secondTx.blockNumber!);
      const secondTimestamp = secondBlock!.timestamp;

      const afterSecond = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // After bonding ends: costBasis = newTotalValue (reset)
      // At 1:1 share price: totalValue = totalShares = 5 + 3 = 8 ETH
      const totalShares = firstStake + secondStake;
      afterSecond.shares.should.eq(totalShares);
      afterSecond.costBasis.should.eq(totalShares); // At 1:1, costBasis = totalValue = totalShares

      // New eligibility: currentTimestamp + (stakeAmount * bondingPeriod) / totalValue
      // = secondTimestamp + (3 * 432000) / 8 = secondTimestamp + 162000
      const expectedBondingTime = (secondStake * BigInt(bondingPeriod)) / totalShares;
      const expectedEligibility = BigInt(secondTimestamp) + expectedBondingTime;
      afterSecond.rewardEligibilityTimestamp.should.eq(expectedEligibility);
    });

    it("should track exact values: stake -> partial unstake -> stake sequence", async function () {
      // Step 1: Stake 10 ETH
      const firstStake = parseEther(10);
      const firstTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: firstStake });
      const firstBlock = await ethers.provider.getBlock(firstTx.blockNumber!);
      const firstTimestamp = firstBlock!.timestamp;

      // Step 2: Wait 1 day (4 days remaining)
      await helpers.time.increase(day);

      // Step 3: Unstake 5 ETH (50%)
      const unstakeShares = parseEther(5);
      const unstakeTx = await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);
      const unstakeBlock = await ethers.provider.getBlock(unstakeTx.blockNumber!);
      const unstakeTimestamp = unstakeBlock!.timestamp;

      const afterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Cost basis: 10 - 5 = 5 ETH
      afterUnstake.costBasis.should.eq(parseEther(5));
      afterUnstake.shares.should.eq(parseEther(5));

      // Anti-gaming: remaining * (10/5) = remaining * 2, capped at bondingPeriod
      const remainingBeforeUnstake = BigInt(firstTimestamp + bondingPeriod - unstakeTimestamp);
      let extendedTime = (remainingBeforeUnstake * firstStake) / (firstStake - unstakeShares);
      if (extendedTime > BigInt(bondingPeriod)) {
        extendedTime = BigInt(bondingPeriod);
      }
      const eligibilityAfterUnstake = BigInt(unstakeTimestamp) + extendedTime;
      afterUnstake.rewardEligibilityTimestamp.should.eq(eligibilityAfterUnstake);

      // Step 4: Wait 1 day
      await helpers.time.increase(day);

      // Step 5: Stake 3 ETH (still in bonding due to extension)
      const thirdStake = parseEther(3);
      const thirdTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: thirdStake });
      const thirdBlock = await ethers.provider.getBlock(thirdTx.blockNumber!);
      const thirdTimestamp = thirdBlock!.timestamp;

      const afterThirdStake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Cost basis: 5 + 3 = 8 ETH (still in bonding, so add to existing)
      afterThirdStake.costBasis.should.eq(parseEther(8));
      afterThirdStake.shares.should.eq(parseEther(8));

      // Weighted average time
      const oldValue = parseEther(5); // shares * shareToVana at 1:1
      const newTotal = parseEther(8);
      const remainingAfterUnstake = eligibilityAfterUnstake - BigInt(thirdTimestamp);
      const weightedTime = (oldValue * remainingAfterUnstake + thirdStake * BigInt(bondingPeriod)) / newTotal;
      const expectedFinalEligibility = BigInt(thirdTimestamp) + weightedTime;
      afterThirdStake.rewardEligibilityTimestamp.should.eq(expectedFinalEligibility);
    });

    it("should track exact values: multiple stakes accumulating during bonding", async function () {
      // Stake 1: 2 ETH
      const stake1 = parseEther(2);
      const tx1 = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stake1 });
      const block1 = await ethers.provider.getBlock(tx1.blockNumber!);
      const ts1 = block1!.timestamp;

      const after1 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      after1.costBasis.should.eq(stake1);
      after1.shares.should.eq(stake1);
      const elig1 = ts1 + bondingPeriod;
      after1.rewardEligibilityTimestamp.should.eq(elig1);

      // Wait 1 day
      await helpers.time.increase(day);

      // Stake 2: 3 ETH
      const stake2 = parseEther(3);
      const tx2 = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stake2 });
      const block2 = await ethers.provider.getBlock(tx2.blockNumber!);
      const ts2 = block2!.timestamp;

      const after2 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      after2.costBasis.should.eq(stake1 + stake2);
      after2.shares.should.eq(stake1 + stake2);

      // Weighted: (2 * remaining + 3 * 5days) / 5
      const remaining2 = BigInt(elig1 - ts2);
      const weighted2 = (stake1 * remaining2 + stake2 * BigInt(bondingPeriod)) / (stake1 + stake2);
      const elig2 = BigInt(ts2) + weighted2;
      after2.rewardEligibilityTimestamp.should.eq(elig2);

      // Wait 1 day
      await helpers.time.increase(day);

      // Stake 3: 5 ETH
      const stake3 = parseEther(5);
      const tx3 = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stake3 });
      const block3 = await ethers.provider.getBlock(tx3.blockNumber!);
      const ts3 = block3!.timestamp;

      const after3 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      after3.costBasis.should.eq(stake1 + stake2 + stake3);
      after3.costBasis.should.eq(parseEther(10));
      after3.shares.should.eq(parseEther(10));

      // Weighted: (5 * remaining + 5 * 5days) / 10
      const remaining3 = elig2 - BigInt(ts3);
      const oldValue3 = stake1 + stake2; // 5 ETH
      const totalValue3 = stake1 + stake2 + stake3; // 10 ETH
      const weighted3 = (oldValue3 * remaining3 + stake3 * BigInt(bondingPeriod)) / totalValue3;
      const elig3 = BigInt(ts3) + weighted3;
      after3.rewardEligibilityTimestamp.should.eq(elig3);
    });

    it("should track exact values: full unstake resets everything", async function () {
      // Stake 8 ETH
      const stakeAmount = parseEther(8);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const afterStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      afterStake.costBasis.should.eq(stakeAmount);
      afterStake.shares.should.eq(stakeAmount);

      // Wait 2 days
      await helpers.time.increase(2 * day);

      // Full unstake
      await vanaPoolStaking.connect(user2).unstake(1, stakeAmount, 0);

      const afterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      afterUnstake.costBasis.should.eq(0);
      afterUnstake.shares.should.eq(0);
      // rewardEligibilityTimestamp is not reset but doesn't matter since shares = 0

      // Stake again: 4 ETH (fresh start)
      const newStake = parseEther(4);
      const newTx = await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: newStake });
      const newBlock = await ethers.provider.getBlock(newTx.blockNumber!);
      const newTimestamp = newBlock!.timestamp;

      const afterNewStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      afterNewStake.costBasis.should.eq(newStake);
      afterNewStake.shares.should.eq(newStake);
      // Fresh bonding period since previous was fully unstaked (eligibility was in past or shares were 0)
      afterNewStake.rewardEligibilityTimestamp.should.eq(newTimestamp + bondingPeriod);
    });

    it("should track exact values: partial unstake reducing cost basis proportionally", async function () {
      // Stake 12 ETH
      const stakeAmount = parseEther(12);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Wait 6 days (bonding ended)
      await helpers.time.increase(6 * day);

      const beforeUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Partial unstake: 3 ETH (25%)
      const unstakeShares = parseEther(3);
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);

      const afterUnstake = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Cost basis reduced proportionally: 12 * (1 - 3/12) = 12 * 0.75 = 9 ETH
      // Or: 12 - (12 * 3 / 12) = 12 - 3 = 9 ETH
      const proportionalReduction = (beforeUnstake.costBasis * unstakeShares) / beforeUnstake.shares;
      const expectedCostBasis = beforeUnstake.costBasis - proportionalReduction;
      afterUnstake.costBasis.should.eq(expectedCostBasis);
      afterUnstake.costBasis.should.eq(parseEther(9));

      // Shares: 12 - 3 = 9
      afterUnstake.shares.should.eq(parseEther(9));

      // Eligibility unchanged (unstaked after bonding ended)
      afterUnstake.rewardEligibilityTimestamp.should.eq(beforeUnstake.rewardEligibilityTimestamp);
    });
  });

  describe("Earned Rewards Tracking", () => {
    const bondingPeriod = 5 * day;

    beforeEach(async () => {
      await deploy();

      // Set bonding period to 5 days
      await vanaPoolStaking.connect(owner).updateBondingPeriod(bondingPeriod);

      // Create an entity for testing
      await vanaPoolEntity.connect(maintainer).createEntity(
        {
          ownerAddress: user1.address,
          name: "Test Entity",
        },
        { value: minRegistrationStake },
      );
    });

    it("should return 0 earned rewards immediately after stake", async function () {
      const stakeAmount = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      const earnedRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedRewards.should.eq(0);
    });

    it("should track unrealized rewards as share price increases", async function () {
      // User2 stakes 100 VANA
      const stakeAmount = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Add rewards to entity and process them
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(10) });
      await helpers.time.increase(30 * day);
      await vanaPoolEntity.processRewards(1);

      // Check earned rewards (should be unrealized since no unstake yet)
      const earnedRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);

      // Should have some unrealized rewards > 0
      earnedRewards.should.be.gt(0);

      // Unrealized interest should equal earned rewards at this point (no realized yet)
      const unrealizedInterest = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      earnedRewards.should.eq(unrealizedInterest);

      // realizedRewards should still be 0
      const stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      stakerEntity.realizedRewards.should.eq(0);
    });

    it("should track realized rewards after unstaking (after eligibility)", async function () {
      // User2 stakes 100 VANA
      const stakeAmount = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Add rewards and process
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(20) });
      await helpers.time.increase(30 * day); // Well past bonding period
      await vanaPoolEntity.processRewards(1);

      // Get share value before unstake
      const shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const stakerBefore = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Unstake 40% of shares (after eligibility)
      const unstakeShares = (stakerBefore.shares * 40n) / 100n;
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);

      const stakerAfter = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // realizedRewards should now be > 0 (the rewards portion of what was unstaked)
      stakerAfter.realizedRewards.should.be.gt(0);

      // Calculate expected realized rewards
      // Note: There may be tiny rounding differences due to share price updates during unstake
      const proportionalCostBasis = (stakerBefore.costBasis * unstakeShares) / stakerBefore.shares;
      const shareValueUnstaked = (unstakeShares * shareToVana) / parseEther(1);
      const expectedRealizedRewards = shareValueUnstaked - proportionalCostBasis;

      // Allow small rounding difference (< 0.0001 ETH)
      const diff = stakerAfter.realizedRewards > expectedRealizedRewards
        ? stakerAfter.realizedRewards - expectedRealizedRewards
        : expectedRealizedRewards - stakerAfter.realizedRewards;
      diff.should.be.lt(parseEther(0.0001));

      // Total earned rewards should be consistent
      const earnedRewardsAfter = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      const unrealizedAfter = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      earnedRewardsAfter.should.eq(unrealizedAfter + stakerAfter.realizedRewards);
    });

    it("should NOT track realized rewards when unstaking before eligibility (forfeited)", async function () {
      // User2 stakes 100 VANA
      const stakeAmount = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Add rewards and process
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(20) });
      await helpers.time.increase(day); // Only 1 day, still in bonding
      await vanaPoolEntity.processRewards(1);

      const stakerBefore = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Unstake 40% of shares (before eligibility - rewards are forfeited)
      const unstakeShares = (stakerBefore.shares * 40n) / 100n;
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);

      const stakerAfter = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // realizedRewards should still be 0 (rewards were forfeited, not realized)
      stakerAfter.realizedRewards.should.eq(0);
    });

    it("should accumulate realized rewards across multiple unstakes", async function () {
      // User2 stakes 100 VANA
      const stakeAmount = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Add rewards and wait past bonding
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(30) });
      await helpers.time.increase(30 * day);
      await vanaPoolEntity.processRewards(1);

      const staker1 = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // First unstake: 30% of shares
      const unstake1Shares = (staker1.shares * 30n) / 100n;
      await vanaPoolStaking.connect(user2).unstake(1, unstake1Shares, 0);

      const stakerAfter1 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const realized1 = stakerAfter1.realizedRewards;
      realized1.should.be.gt(0);

      // Second unstake: 50% of remaining shares
      const staker2 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const unstake2Shares = staker2.shares / 2n;
      await vanaPoolStaking.connect(user2).unstake(1, unstake2Shares, 0);

      const stakerAfter2 = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // realizedRewards should have increased
      stakerAfter2.realizedRewards.should.be.gt(realized1);
    });

    it("should preserve total earned rewards after full unstake", async function () {
      // User2 stakes 100 VANA
      const stakeAmount = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Add rewards and wait past bonding
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(20) });
      await helpers.time.increase(30 * day);
      await vanaPoolEntity.processRewards(1);

      // Get total earned before full unstake
      const earnedBefore = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedBefore.should.be.gt(0);

      // Full unstake
      const staker = await vanaPoolStaking.stakerEntities(user2.address, 1);
      await vanaPoolStaking.connect(user2).unstake(1, staker.shares, 0);

      // After full unstake, earned rewards should be preserved in realizedRewards
      // Note: Small rounding differences may occur due to share price updates during unstake
      const earnedAfter = await vanaPoolStaking.getEarnedRewards(user2.address, 1);

      // Allow small rounding difference (< 0.0001 ETH)
      const diff = earnedAfter > earnedBefore
        ? earnedAfter - earnedBefore
        : earnedBefore - earnedAfter;
      diff.should.be.lt(parseEther(0.0001));

      // All rewards are now realized
      const stakerAfter = await vanaPoolStaking.stakerEntities(user2.address, 1);
      stakerAfter.shares.should.eq(0);

      // realizedRewards should be close to earnedBefore
      const realizedDiff = stakerAfter.realizedRewards > earnedBefore
        ? stakerAfter.realizedRewards - earnedBefore
        : earnedBefore - stakerAfter.realizedRewards;
      realizedDiff.should.be.lt(parseEther(0.0001));
    });

    it("should track rewards correctly across stake -> unstake -> stake sequence", async function () {
      // User2 stakes 100 VANA
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(100) });

      // Add rewards and wait past bonding
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(20) });
      await helpers.time.increase(30 * day);
      await vanaPoolEntity.processRewards(1);

      // Partial unstake (50%)
      const staker1 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      await vanaPoolStaking.connect(user2).unstake(1, staker1.shares / 2n, 0);

      const realizedAfterUnstake = (await vanaPoolStaking.stakerEntities(user2.address, 1)).realizedRewards;
      realizedAfterUnstake.should.be.gt(0);

      // Stake more VANA while reward-eligible
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(50) });

      // With separate tracking: vestedRewards captures unrealized when staking while eligible
      // realizedRewards only tracks actual withdrawals
      const stakerAfterStake = await vanaPoolStaking.stakerEntities(user2.address, 1);
      stakerAfterStake.vestedRewards.should.be.gt(0n); // Captured unrealized into vested
      stakerAfterStake.realizedRewards.should.eq(realizedAfterUnstake); // Unchanged (no new unstake)

      // getEarnedRewards = accruingInterest + realizedRewards
      // (accruingInterest already includes vestedRewards)
      const totalEarned = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      const accruingInterest = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      totalEarned.should.eq(accruingInterest + stakerAfterStake.realizedRewards);
    });

    it("should return 0 for address with no stake history", async function () {
      const earnedRewards = await vanaPoolStaking.getEarnedRewards(user4.address, 1);
      earnedRewards.should.eq(0);
    });

    it("should realize rewards when staking while reward-eligible", async function () {
      // This test verifies that unrealized rewards are captured into vestedRewards
      // when a user stakes additional amounts while reward-eligible

      // === Step 1: Initial stake of 100 VANA ===
      const initialStake = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: initialStake });

      // Verify initial state
      let stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      stakerEntity.shares.should.eq(initialStake);
      stakerEntity.costBasis.should.eq(initialStake);
      stakerEntity.realizedRewards.should.eq(0n);
      stakerEntity.vestedRewards.should.eq(0n);

      // === Step 2: Add rewards and wait for bonding period ===
      const rewardAmount = parseEther(50);
      await vanaPoolEntity.connect(user3).addRewards(1, { value: rewardAmount });
      await helpers.time.increase(6 * day); // Past 5-day bonding period
      await vanaPoolEntity.processRewards(1);

      // Check unrealized rewards before second stake
      const unrealizedBeforeSecondStake = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      unrealizedBeforeSecondStake.should.be.gt(0n);

      const earnedBeforeSecondStake = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedBeforeSecondStake.should.eq(unrealizedBeforeSecondStake); // No realized yet

      // === Step 3: Stake 200 more VANA while reward-eligible ===
      const secondStake = parseEther(200);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: secondStake });

      // Verify that unrealized rewards were captured into vestedRewards (not realizedRewards)
      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // vestedRewards should now be > 0 (previously unrealized rewards captured when staking while eligible)
      // Note: stake() calls processRewards() internally which may slightly change the share price
      stakerEntity.vestedRewards.should.be.gt(0n);
      // realizedRewards should still be 0 (no actual withdrawal)
      stakerEntity.realizedRewards.should.eq(0n);

      // After staking while eligible, costBasis = newTotalValue, so pending interest should be ~0
      // getAccruingInterest = pendingInterest + vestedRewards ≈ vestedRewards
      const accruingAfterSecondStake = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      // Accruing should be approximately equal to vested (pending is ~0)
      // Allow small rounding difference (< 1000 wei)
      const pendingAfterSecondStake = accruingAfterSecondStake - stakerEntity.vestedRewards;
      pendingAfterSecondStake.should.be.lt(1000n);

      // Total earned = accruingInterest + realizedRewards = accruingInterest (no realized yet)
      const earnedAfterSecondStake = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterSecondStake.should.eq(accruingAfterSecondStake);

      // === Step 4: Add more rewards and wait ===
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(30) });
      await helpers.time.increase(6 * day);
      await vanaPoolEntity.processRewards(1);

      // Now we should have new accruing interest (pending + vested)
      const accruingAfterMoreRewards = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      accruingAfterMoreRewards.should.be.gt(accruingAfterSecondStake);

      const earnedAfterMoreRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      // Total earned = accruing + realized = accruing (no realized yet)
      earnedAfterMoreRewards.should.eq(accruingAfterMoreRewards);

      // Total earned should be greater than before (accumulated more rewards)
      earnedAfterMoreRewards.should.be.gt(earnedAfterSecondStake);
    });

    it("should accumulate vested rewards across multiple eligible stakes", async function () {
      // Test that vested rewards accumulate correctly across multiple stake operations
      // (vestedRewards = rewards rolled into costBasis when staking while eligible)

      // === Stake 1: 100 VANA ===
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(100) });

      // Add rewards and wait
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(20) });
      await helpers.time.increase(6 * day);
      await vanaPoolEntity.processRewards(1);

      const earned1 = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earned1.should.be.gt(0n);

      // === Stake 2: 50 VANA (while eligible) ===
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(50) });

      let stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const vested1 = stakerEntity.vestedRewards;
      // Vested should capture the earned rewards (stake() calls processRewards() internally,
      // so vested1 might be slightly different from earned1 due to timing)
      vested1.should.be.gt(0n);
      // realizedRewards should be 0 (no unstake yet)
      stakerEntity.realizedRewards.should.eq(0n);

      // Add more rewards and wait
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(20) });
      await helpers.time.increase(6 * day);
      await vanaPoolEntity.processRewards(1);

      const earned2 = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earned2.should.be.gt(vested1); // Should have accumulated more

      // === Stake 3: 25 VANA (while eligible again) ===
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(25) });

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const vested2 = stakerEntity.vestedRewards;

      // Vested should have increased (accumulated vested1 + new unrealized)
      vested2.should.be.gt(vested1);
      // realizedRewards should still be 0 (no unstake yet)
      stakerEntity.realizedRewards.should.eq(0n);

      // Total earned = accruingInterest + realizedRewards
      // Since no unstake yet, realizedRewards = 0, so earnedAfterStake3 = accruingInterest
      const earnedAfterStake3 = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      const accruingAfterStake3 = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      earnedAfterStake3.should.eq(accruingAfterStake3);
      // accruingInterest should include vested2 (pendingInterest ~0 after eligible stake)
      // Allow small rounding difference
      const pendingAfterStake3 = accruingAfterStake3 - vested2;
      pendingAfterStake3.should.be.lt(1000n);
    });

    it("should realize rewards with multiple stakes and unstakes before and after eligibility", async function () {
      // Comprehensive test with exact calculations for all stake/unstake operations

      // === Phase 1: Stake during bonding period (no rewards realized) ===

      // Stake 1: 100 VANA
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(100) });

      let stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      stakerEntity.realizedRewards.should.eq(0n);
      stakerEntity.vestedRewards.should.eq(0n);
      stakerEntity.costBasis.should.eq(parseEther(100));
      stakerEntity.shares.should.eq(parseEther(100)); // 1:1 ratio at start

      // Add rewards (goes to locked pool)
      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(20) });
      await helpers.time.increase(2 * day); // Still in bonding (5 days)
      await vanaPoolEntity.processRewards(1);

      // Stake 2: 50 VANA during bonding period
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(50) });

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      // During bonding: costBasis += stakeAmount, both rewards counters unchanged
      stakerEntity.realizedRewards.should.eq(0n);
      stakerEntity.vestedRewards.should.eq(0n);
      stakerEntity.costBasis.should.eq(parseEther(150)); // 100 + 50

      // Unstake 30 shares during bonding period (forfeits rewards, no realized)
      const stakerBeforeUnstake1 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const unstakeShares1 = parseEther(30);
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares1, 0);

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      // During bonding unstake: both rewards counters stay 0 (rewards forfeited)
      stakerEntity.realizedRewards.should.eq(0n);
      stakerEntity.vestedRewards.should.eq(0n);
      // Exact cost basis after unstake
      const expectedCostBasis1 = stakerBeforeUnstake1.costBasis - (stakerBeforeUnstake1.costBasis * unstakeShares1) / stakerBeforeUnstake1.shares;
      stakerEntity.costBasis.should.eq(expectedCostBasis1);
      // Exact shares after unstake
      stakerEntity.shares.should.eq(stakerBeforeUnstake1.shares - unstakeShares1);

      // === Phase 2: Cross into eligibility ===

      await helpers.time.increase(5 * day); // Now past bonding period
      await vanaPoolEntity.processRewards(1);

      // Calculate exact pending interest after becoming eligible
      const shareToVanaAfterEligible = await vanaPoolEntity.entityShareToVana(1);
      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const expectedPendingAfterEligible = (stakerEntity.shares * shareToVanaAfterEligible) / parseEther(1) - stakerEntity.costBasis;

      const accruingAfterEligible = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      // accruingInterest = pendingInterest + vestedRewards (vested is 0 at this point)
      accruingAfterEligible.should.eq(expectedPendingAfterEligible + stakerEntity.vestedRewards);

      const earnedAfterEligible = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterEligible.should.eq(accruingAfterEligible + stakerEntity.realizedRewards);

      // === Phase 3: Unstake after eligibility (realizes rewards) ===

      const stakerBeforeUnstake2 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const unstakeShares2 = parseEther(40);

      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares2, 0);

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Exact proportional cost basis reduction
      const proportionalCostBasis2 = (stakerBeforeUnstake2.costBasis * unstakeShares2) / stakerBeforeUnstake2.shares;
      stakerEntity.costBasis.should.eq(stakerBeforeUnstake2.costBasis - proportionalCostBasis2);
      // Exact shares
      stakerEntity.shares.should.eq(stakerBeforeUnstake2.shares - unstakeShares2);
      // Realized rewards should have increased (we're eligible, and there are unrealized rewards)
      const realizedAfterUnstake2 = stakerEntity.realizedRewards;
      realizedAfterUnstake2.should.be.gt(0n);
      // Vested should still be 0 (only set on stake while eligible)
      stakerEntity.vestedRewards.should.eq(0n);

      // Verify getEarnedRewards = accruingInterest + realizedRewards
      const accruingAfterUnstake2 = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      const earnedAfterUnstake2 = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterUnstake2.should.eq(accruingAfterUnstake2 + realizedAfterUnstake2);

      // === Phase 4: Stake after eligibility (captures unrealized into vested) ===

      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(15) });
      await helpers.time.increase(3 * day);
      await vanaPoolEntity.processRewards(1);

      const stakerBeforeStake3 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      // Calculate unrealized before stake (share price may change slightly during stake due to internal processRewards)
      const shareToVanaBeforeStake3 = await vanaPoolEntity.entityShareToVana(1);
      const oldValueBeforeStake3 = (stakerBeforeStake3.shares * shareToVanaBeforeStake3) / parseEther(1);
      const unrealizedBeforeStake3 = oldValueBeforeStake3 > stakerBeforeStake3.costBasis
        ? oldValueBeforeStake3 - stakerBeforeStake3.costBasis
        : 0n;

      // Stake 3: 75 VANA after eligibility
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(75) });

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // With separate tracking: vestedRewards captures unrealized when staking while eligible
      // realizedRewards should be unchanged (no new unstake)
      stakerEntity.realizedRewards.should.eq(realizedAfterUnstake2);
      stakerEntity.vestedRewards.should.be.gt(0n);
      const capturedUnrealized3 = stakerEntity.vestedRewards;

      // Verify the vested increase is close to what we calculated (within small rounding due to processRewards)
      // The difference should be minimal - less than 0.001 VANA
      const unrealizedDiff = unrealizedBeforeStake3 > capturedUnrealized3
        ? unrealizedBeforeStake3 - capturedUnrealized3
        : capturedUnrealized3 - unrealizedBeforeStake3;
      unrealizedDiff.should.be.lt(parseEther(0.001));

      // Verify costBasis = total value of shares (contract-computed)
      // After eligible stake, pendingInterest should be ~0 (tiny rounding allowed due to share price updates)
      // getAccruingInterest = pendingInterest + vestedRewards
      const accruingAfterStake3 = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      // pendingInterest should be ~0, so accruingInterest should be approximately vestedRewards
      const pendingAfterStake3 = accruingAfterStake3 - stakerEntity.vestedRewards;
      pendingAfterStake3.should.be.lt(1000n);

      // Verify earnedRewards = accruingInterest + realizedRewards
      const earnedAfterStake3 = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterStake3.should.eq(accruingAfterStake3 + stakerEntity.realizedRewards);

      // === Phase 5: Multiple operations after eligibility ===

      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(25) });
      await helpers.time.increase(4 * day);
      await vanaPoolEntity.processRewards(1);

      // Unstake some shares (realizes more rewards)
      const stakerBeforeUnstake3 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const unstakeShares3 = parseEther(20);

      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares3, 0);

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Exact proportional cost basis reduction
      const proportionalCostBasis3 = (stakerBeforeUnstake3.costBasis * unstakeShares3) / stakerBeforeUnstake3.shares;
      stakerEntity.costBasis.should.eq(stakerBeforeUnstake3.costBasis - proportionalCostBasis3);
      // Exact shares
      stakerEntity.shares.should.eq(stakerBeforeUnstake3.shares - unstakeShares3);
      // Realized rewards should have increased (unstake realizes rewards + proportional vested)
      stakerEntity.realizedRewards.should.be.gt(stakerBeforeUnstake3.realizedRewards);
      // Proportional vested rewards should have moved to realized
      const proportionalVested3 = (stakerBeforeUnstake3.vestedRewards * unstakeShares3) / stakerBeforeUnstake3.shares;
      stakerEntity.vestedRewards.should.eq(stakerBeforeUnstake3.vestedRewards - proportionalVested3);

      // Verify getEarnedRewards = accruingInterest + realizedRewards
      const accruingAfterUnstake3 = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      const earnedAfterUnstake3 = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterUnstake3.should.eq(accruingAfterUnstake3 + stakerEntity.realizedRewards);

      // Stake again (captures any unrealized into vested)
      const stakerBeforeStake4 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const shareToVanaBeforeStake4 = await vanaPoolEntity.entityShareToVana(1);
      const oldValueBeforeStake4 = (stakerBeforeStake4.shares * shareToVanaBeforeStake4) / parseEther(1);
      const unrealizedBeforeStake4 = oldValueBeforeStake4 > stakerBeforeStake4.costBasis
        ? oldValueBeforeStake4 - stakerBeforeStake4.costBasis
        : 0n;

      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: parseEther(30) });

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      // realizedRewards should be unchanged (no unstake)
      stakerEntity.realizedRewards.should.eq(stakerBeforeStake4.realizedRewards);
      // vestedRewards should have increased (captures unrealized)
      stakerEntity.vestedRewards.should.be.gte(stakerBeforeStake4.vestedRewards);
      const capturedUnrealized4 = stakerEntity.vestedRewards - stakerBeforeStake4.vestedRewards;

      // Verify captured unrealized is close to what we calculated
      const unrealizedDiff4 = unrealizedBeforeStake4 > capturedUnrealized4
        ? unrealizedBeforeStake4 - capturedUnrealized4
        : capturedUnrealized4 - unrealizedBeforeStake4;
      unrealizedDiff4.should.be.lt(parseEther(0.001));

      // After eligible stake, pendingInterest should be ~0 (tiny rounding allowed)
      // getAccruingInterest = pendingInterest + vestedRewards
      const accruingAfterStake4 = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      const pendingAfterStake4 = accruingAfterStake4 - stakerEntity.vestedRewards;
      pendingAfterStake4.should.be.lt(1000n);

      // Verify earnedRewards = accruingInterest + realizedRewards
      const earnedAfterStake4 = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterStake4.should.eq(accruingAfterStake4 + stakerEntity.realizedRewards);

      // === Phase 6: Final unstake all ===

      await vanaPoolEntity.connect(user3).addRewards(1, { value: parseEther(10) });
      await helpers.time.increase(2 * day);
      await vanaPoolEntity.processRewards(1);

      const stakerBeforeFinal = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const finalShares = stakerBeforeFinal.shares;

      // Unstake all remaining shares
      await vanaPoolStaking.connect(user2).unstake(1, finalShares, 0);

      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // All shares gone
      stakerEntity.shares.should.eq(0n);
      stakerEntity.costBasis.should.eq(0n);
      // Realized rewards should have increased from final unstake (includes unrealized + all vested)
      stakerEntity.realizedRewards.should.be.gt(stakerBeforeFinal.realizedRewards);
      // Vested should be 0 after full unstake (all moved to realized)
      stakerEntity.vestedRewards.should.eq(0n);

      // After full unstake: earnedRewards = realized only (vested moved to realized, no unrealized)
      const earnedAfterFinal = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterFinal.should.eq(stakerEntity.realizedRewards);

      // Unrealized should be exactly 0
      const unrealizedAfterFinal = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      unrealizedAfterFinal.should.eq(0n);
    });

    it("should track earned rewards through complete scenario: stake -> unstake -> stake -> unstake all", async function () {
      // This test follows the exact example scenario with precise calculations
      // All assertions use exact values computed from contract state

      // === Day 0: User stakes 100 VANA ===
      const initialStake = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: initialStake });

      // Get entity state after stake for tracking
      let entity = await vanaPoolEntity.entities(1);
      const initialTotalShares = entity.totalShares;
      const initialActivePool = entity.activeRewardPool;
      let lastUpdateTimestamp = entity.lastUpdateTimestamp;

      // Verify initial state - exact values
      let stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const userInitialShares = stakerEntity.shares;
      stakerEntity.shares.should.eq(initialStake); // 100 shares at 1:1
      stakerEntity.costBasis.should.eq(initialStake); // 100 VANA
      stakerEntity.realizedRewards.should.eq(0n);
      stakerEntity.vestedRewards.should.eq(0n);

      // getEarnedRewards should return exactly 0
      let earnedRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedRewards.should.eq(0n);

      // === Day 3: Share price rises (still in bonding) ===
      const rewardAmount1 = parseEther(50);
      await vanaPoolEntity.connect(user3).addRewards(1, { value: rewardAmount1 });
      await helpers.time.increase(3 * day);

      // Process rewards and capture exact timestamp
      let processTx = await vanaPoolEntity.processRewards(1);
      let processBlock = await ethers.provider.getBlock(processTx.blockNumber!);
      let processTimestamp = BigInt(processBlock!.timestamp);

      // Calculate exact yield distributed
      let timeElapsed = processTimestamp - lastUpdateTimestamp;
      const maxAPY = entity.maxAPY;
      let expectedYield = await vanaPoolEntity.calculateYield(initialActivePool, maxAPY, timeElapsed);
      let actualDistributed = expectedYield > rewardAmount1 ? rewardAmount1 : expectedYield;

      // Verify exact share price
      entity = await vanaPoolEntity.entities(1);
      const activePoolDay3 = entity.activeRewardPool;
      activePoolDay3.should.eq(initialActivePool + actualDistributed);

      let shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const expectedShareToVanaDay3 = (activePoolDay3 * parseEther(1)) / initialTotalShares;
      shareToVana.should.eq(expectedShareToVanaDay3);

      // Calculate exact unrealized rewards
      const userValueDay3 = (userInitialShares * shareToVana) / parseEther(1);
      const expectedUnrealizedDay3 = userValueDay3 - initialStake;

      earnedRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedRewards.should.eq(expectedUnrealizedDay3);

      // both rewards counters should still be exactly 0
      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);
      stakerEntity.realizedRewards.should.eq(0n);
      stakerEntity.vestedRewards.should.eq(0n);

      // === Day 6: User unstakes 40 shares (after eligibility) ===
      await helpers.time.increase(3 * day); // Now past 5-day bonding period

      // Capture state before unstake
      const stakerBeforeUnstake1 = await vanaPoolStaking.stakerEntities(user2.address, 1);
      lastUpdateTimestamp = entity.lastUpdateTimestamp;

      // Unstake 40 shares - this calls processRewards internally
      const unstakeShares1 = parseEther(40);
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares1, 0);

      // Get share price used during unstake (after processRewards)
      shareToVana = await vanaPoolEntity.entityShareToVana(1);

      // Calculate exact values
      const proportionalCostBasis1 = (stakerBeforeUnstake1.costBasis * unstakeShares1) / stakerBeforeUnstake1.shares;
      const shareValue1 = (unstakeShares1 * shareToVana) / parseEther(1);
      const expectedRealized1 = shareValue1 - proportionalCostBasis1;

      // Verify exact state after unstake
      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Exact shares: 100 - 40 = 60
      stakerEntity.shares.should.eq(parseEther(60));

      // Exact cost basis: 100 - 40 = 60
      const expectedCostBasisAfterUnstake1 = stakerBeforeUnstake1.costBasis - proportionalCostBasis1;
      stakerEntity.costBasis.should.eq(expectedCostBasisAfterUnstake1);

      // Exact realized rewards
      stakerEntity.realizedRewards.should.eq(expectedRealized1);

      // Verify exact total earned = accruingInterest + realizedRewards
      const accruingDay6 = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      const expectedUserValueDay6 = (stakerEntity.shares * shareToVana) / parseEther(1);
      const expectedPendingDay6 = expectedUserValueDay6 - stakerEntity.costBasis;
      // accruingInterest = pendingInterest + vestedRewards (vested is 0 at this point)
      accruingDay6.should.eq(expectedPendingDay6 + stakerEntity.vestedRewards);

      earnedRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedRewards.should.eq(accruingDay6 + stakerEntity.realizedRewards);

      // === Day 8: User stakes 50 more VANA ===
      await helpers.time.increase(2 * day);

      // Add more rewards
      const rewardAmount2 = parseEther(20);
      await vanaPoolEntity.connect(user3).addRewards(1, { value: rewardAmount2 });
      await vanaPoolEntity.processRewards(1);

      const realizedBeforeStake = stakerEntity.realizedRewards;
      const vestedBeforeStake = stakerEntity.vestedRewards;
      const stakerBeforeStake2 = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Stake 50 VANA
      const additionalStake = parseEther(50);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: additionalStake });

      // Get share price after stake
      shareToVana = await vanaPoolEntity.entityShareToVana(1);
      const vanaToShare = await vanaPoolEntity.vanaToEntityShare(1);

      // Calculate exact new shares issued
      const newSharesIssued = (additionalStake * vanaToShare) / parseEther(1);
      const expectedTotalShares = stakerBeforeStake2.shares + newSharesIssued;

      // Verify exact state after additional stake
      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Exact shares
      stakerEntity.shares.should.eq(expectedTotalShares);

      // Since user was reward-eligible, costBasis = newTotalValue
      const expectedCostBasisAfterStake2 = (expectedTotalShares * shareToVana) / parseEther(1);
      stakerEntity.costBasis.should.eq(expectedCostBasisAfterStake2);

      // With separate tracking: vestedRewards increases when staking while eligible (captures unrealized)
      // realizedRewards should be unchanged (no unstake)
      stakerEntity.realizedRewards.should.eq(realizedBeforeStake);
      stakerEntity.vestedRewards.should.be.gt(vestedBeforeStake);

      // Verify exact total earned = accruingInterest + realizedRewards
      const accruingDay8 = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      earnedRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedRewards.should.eq(accruingDay8 + stakerEntity.realizedRewards);

      // === Day 15: User unstakes ALL remaining shares ===
      await helpers.time.increase(7 * day);

      // Add final rewards
      const rewardAmount3 = parseEther(30);
      await vanaPoolEntity.connect(user3).addRewards(1, { value: rewardAmount3 });
      await vanaPoolEntity.processRewards(1);

      // Capture state before final unstake
      const stakerBeforeFinal = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const realizedBeforeFinal = stakerBeforeFinal.realizedRewards;

      // Full unstake - this internally calls processRewards() which may update share price
      await vanaPoolStaking.connect(user2).unstake(1, stakerBeforeFinal.shares, 0);

      // Verify exact final state
      stakerEntity = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // All shares gone
      stakerEntity.shares.should.eq(0n);

      // Cost basis exactly 0
      stakerEntity.costBasis.should.eq(0n);

      // Realized rewards should have increased (unstake realizes + all remaining vested)
      stakerEntity.realizedRewards.should.be.gt(realizedBeforeFinal);
      // Vested should be 0 after full unstake (all moved to realized)
      stakerEntity.vestedRewards.should.eq(0n);

      // Verify the realized rewards formula: realizedRewards = old_realized + (shareValue - costBasis)
      // Since we know old_realized and costBasis, we can derive shareValue
      const derivedShareValue = stakerEntity.realizedRewards - realizedBeforeFinal + stakerBeforeFinal.costBasis;
      // The derived shareValue should be positive (user made profit)
      derivedShareValue.should.be.gt(stakerBeforeFinal.costBasis);

      // earnedRewards = accruingInterest + realizedRewards
      // After full unstake: accruing = 0 (no shares, no vested), so earnedRewards = realizedRewards
      const earnedAfterFullUnstake = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedAfterFullUnstake.should.eq(stakerEntity.realizedRewards);

      // Verify accruingInterest is 0 after full unstake (0 pendingInterest + 0 vestedRewards)
      const finalAccruing = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      finalAccruing.should.eq(0n);
      earnedAfterFullUnstake.should.eq(finalAccruing + stakerEntity.realizedRewards);
    });

    it("should compute exact earned rewards using contract's calculateYield", async function () {
      // This test computes exact expected values by calling the contract's calculateYield
      // and tracking share prices at each step

      // === Setup: Stake 100 VANA ===
      const stakeAmount = parseEther(100);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

      // Get initial state
      const entityAfterStake = await vanaPoolEntity.entities(1);
      const initialActivePool = entityAfterStake.activeRewardPool;
      const initialTotalShares = entityAfterStake.totalShares;
      const initialLastUpdate = entityAfterStake.lastUpdateTimestamp;
      const userShares = (await vanaPoolStaking.stakerEntities(user2.address, 1)).shares;

      // Verify initial share price is 1:1
      const initialShareToVana = await vanaPoolEntity.entityShareToVana(1);
      initialShareToVana.should.eq(parseEther(1)); // 1e18 = 1:1 ratio

      // === Add rewards and process ===
      const rewardAmount = parseEther(50);
      await vanaPoolEntity.connect(user3).addRewards(1, { value: rewardAmount });

      // Advance time by 3 days
      await helpers.time.increase(3 * day);

      // Process rewards and capture the actual timestamp used
      const processTx = await vanaPoolEntity.processRewards(1);
      const processBlock = await ethers.provider.getBlock(processTx.blockNumber!);
      const processTimestamp = BigInt(processBlock!.timestamp);

      // Calculate exact time elapsed as the contract sees it
      const actualTimeElapsed = processTimestamp - initialLastUpdate;

      // Calculate expected yield using contract's formula with actual time
      const maxAPY = entityAfterStake.maxAPY;
      const expectedYield = await vanaPoolEntity.calculateYield(initialActivePool, maxAPY, actualTimeElapsed);

      // Verify the yield was distributed correctly
      const entityAfterProcess = await vanaPoolEntity.entities(1);
      const actualDistributed = entityAfterProcess.activeRewardPool - initialActivePool;

      // The actual distributed should equal expected yield (capped by lockedRewardPool)
      const expectedDistributed = expectedYield > rewardAmount ? rewardAmount : expectedYield;
      actualDistributed.should.eq(expectedDistributed);

      // === Calculate exact share price after rewards ===
      const newActivePool = entityAfterProcess.activeRewardPool;
      const expectedShareToVana = (newActivePool * parseEther(1)) / initialTotalShares;
      const actualShareToVana = await vanaPoolEntity.entityShareToVana(1);
      actualShareToVana.should.eq(expectedShareToVana);

      // === Calculate exact user value and pending interest ===
      const expectedUserValue = (userShares * actualShareToVana) / parseEther(1);
      const expectedPending = expectedUserValue - stakeAmount; // costBasis is stakeAmount

      // accruingInterest = pendingInterest + vestedRewards (vested is 0 at this point)
      const stakerEntityNow = await vanaPoolStaking.stakerEntities(user2.address, 1);
      const actualAccruing = await vanaPoolStaking.getAccruingInterest(user2.address, 1);
      actualAccruing.should.eq(expectedPending + stakerEntityNow.vestedRewards);

      // getEarnedRewards = accruingInterest + realizedRewards
      const earnedRewards = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      earnedRewards.should.eq(actualAccruing + stakerEntityNow.realizedRewards);

      // === Wait for bonding period and unstake half ===
      await helpers.time.increase(2 * day); // Past 5-day bonding period

      // Calculate exact values for partial unstake
      // Note: unstake() calls processRewards() internally, so we need to account for that
      const unstakeShares = userShares / 2n;
      const stakerBefore = await vanaPoolStaking.stakerEntities(user2.address, 1);

      // Perform unstake - this processes rewards internally
      await vanaPoolStaking.connect(user2).unstake(1, unstakeShares, 0);

      // Get the share price that was used during unstake (after processRewards was called)
      // Since we're right after unstake, the share price is what the contract used
      const shareToVanaAfterUnstake = await vanaPoolEntity.entityShareToVana(1);

      // Now calculate what the contract calculated
      const proportionalCostBasis = (stakerBefore.costBasis * unstakeShares) / stakerBefore.shares;
      const shareValue = (unstakeShares * shareToVanaAfterUnstake) / parseEther(1);
      const expectedRealized = shareValue - proportionalCostBasis;

      // Verify exact realized rewards
      const stakerAfter = await vanaPoolStaking.stakerEntities(user2.address, 1);
      stakerAfter.realizedRewards.should.eq(expectedRealized);

      // Verify exact remaining cost basis
      const expectedRemainingCostBasis = stakerBefore.costBasis - proportionalCostBasis;
      stakerAfter.costBasis.should.eq(expectedRemainingCostBasis);

      // Verify exact remaining shares
      stakerAfter.shares.should.eq(stakerBefore.shares - unstakeShares);

      // === Verify total earned rewards calculation ===
      const remainingShares = stakerAfter.shares;
      const currentShareToVana = await vanaPoolEntity.entityShareToVana(1);
      const currentValue = (remainingShares * currentShareToVana) / parseEther(1);
      const expectedCurrentUnrealized = currentValue > stakerAfter.costBasis
        ? currentValue - stakerAfter.costBasis
        : 0n;

      const expectedTotalEarned = expectedCurrentUnrealized + stakerAfter.realizedRewards;
      const actualTotalEarned = await vanaPoolStaking.getEarnedRewards(user2.address, 1);
      actualTotalEarned.should.eq(expectedTotalEarned);
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
      // First, stake to increase activeRewardPool
      // With minRegistrationStake = 1 ETH, 6% APY, and 0.1 ETH rewards,
      // the max yield in 1 year is only ~0.0618 ETH (capped by APY)
      // We need a larger stake to allow more rewards to be distributed
      const stakeAmount = parseEther(10);
      await vanaPoolStaking
        .connect(user2)
        .stake(1, user2.address, 0, { value: stakeAmount });

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
      // With 11 ETH staked (1 + 10) and 6% APY, max yield in 1 year is ~0.68 ETH
      // So 0.1 ETH rewards should be fully distributed
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

      const compoundedYield = await vanaPoolEntity.calculateYield(
        principal,
        apy,
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
      console.log(await vanaPoolEntity.calculateExponential(parseEther(2)));
    });
  });
});
