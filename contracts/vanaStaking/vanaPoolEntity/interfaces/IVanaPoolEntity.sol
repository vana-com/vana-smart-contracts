// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IVanaPoolStaking} from "../../vanaPoolStaking/interfaces/IVanaPoolStaking.sol";

interface IVanaPoolEntity {
    enum EntityStatus {
        None,
        Active,
        Removed
    }

    /// @notice Selects how an entity vests rewards from lockedRewardPool into
    ///         activeRewardPool. APY is the original continuous-compounding
    ///         drip (rate = active * (e^(maxAPY*dt) - 1)); STREAM is a
    ///         Synthetix-style linear schedule (rate = scheduledValue / duration).
    ///         Default 0 == APY, so an upgrade leaves every existing entity on
    ///         its current behaviour until a maintainer switches it.
    enum RewardModel {
        APY,
        STREAM
    }

    /// @notice A linear reward stream for an entity in STREAM mode. Holds one
    ///         active entry plus a single queued follow-on entry that becomes
    ///         active automatically when the active one ends (Synthetix V3
    ///         RewardDistribution semantics). All amounts are in wei; the funds
    ///         backing them live in the entity's lockedRewardPool.
    struct RewardSchedule {
        uint128 scheduledValue; // active entry: total to vest over [start, start+duration]
        uint64 start; // active entry: vesting start; <= now vests immediately when duration == 0
        uint32 duration; // active entry: vesting span in seconds; 0 == instant
        uint32 lastUpdate; // watermark: last time the active entry was vested into active pool
        uint128 nextScheduledValue; // queued entry: total, or 0 if nothing queued
        uint64 nextStart; // queued entry: vesting start (>= active entry's end)
        uint32 nextDuration; // queued entry: vesting span in seconds
    }

    struct Entity {
        address ownerAddress;
        EntityStatus status;
        string name;
        uint256 maxAPY; // Maximum APY for this entity (in basis points, 1% = 100)
        uint256 lockedRewardPool; // Locked rewards for this entity
        uint256 activeRewardPool; // Active rewards available for distribution
        uint256 totalShares; // Total shares for this entity
        uint256 lastUpdateTimestamp; // When rewards were last processed
        uint256 totalDistributedRewards; // Cumulative rewards distributed from locked to active pool
        // --- appended in the rewards-models upgrade; safe because Entity is
        //     only ever held in the _entities mapping (per-key base slot) ---
        RewardModel rewardModel; // APY (0, default) or STREAM
        RewardSchedule rewardSchedule; // only used while rewardModel == STREAM
        // --- appended in the commission upgrade; append-safe as above ---
        uint256 commissionRate; // operator cut of each distribution, percent * 1e18 (100% = 100e18); default 0
        uint256 accruedCommission; // wei owed to the entity owner, not yet claimed
    }

    function version() external pure returns (uint256);
    function vanaPoolStaking() external view returns (IVanaPoolStaking);
    function minRegistrationStake() external view returns (uint256);
    function maxAPYDefault() external view returns (uint256);

    struct EntityInfo {
        uint256 entityId;
        address ownerAddress;
        EntityStatus status;
        string name;
        uint256 maxAPY;
        uint256 lockedRewardPool;
        uint256 activeRewardPool;
        uint256 totalShares;
        uint256 lastUpdateTimestamp;
        uint256 totalDistributedRewards;
    }

    function entitiesCount() external view returns (uint256);
    function entities(uint256 entityId) external view returns (EntityInfo memory);
    function entityByName(string calldata entityName) external view returns (EntityInfo memory);

    function entityRewardModel(uint256 entityId) external view returns (RewardModel);
    function entityRewardSchedule(uint256 entityId) external view returns (RewardSchedule memory);
    function committedRewards(uint256 entityId) external view returns (uint256);
    function entityNameToId(string calldata entityName) external view returns (uint256);

    function entityShareToVana(uint256 entityId) external view returns (uint256);
    function vanaToEntityShare(uint256 entityId) external view returns (uint256);

    function pause() external;
    function unpause() external;
    function updateVanaPool(address vanaPoolStakingAddress) external;
    function updateMinRegistrationStake(uint256 newMinRegistrationStake) external;

    struct EntityRegistrationInfo {
        address ownerAddress;
        string name;
    }

    function createEntity(EntityRegistrationInfo calldata entityRegistrationInfo) external payable;
    function updateEntity(uint256 entityId, EntityRegistrationInfo calldata entityRegistrationInfo) external;
    //    function removeEntity(uint256 entityId) external;

    // Entity reward management
    function addRewards(uint256 entityId) external payable;
    function processRewards(uint256 entityId) external;

    function distributeRewards(uint256 entityId, uint256 amount, uint64 start, uint32 duration) external payable;
    function topUpQueuedRewards(uint256 entityId) external payable;
    function updateEntityMaxAPY(uint256 entityId, uint256 newMaxAPY) external;

    function updateEntityRewardModel(uint256 entityId, RewardModel model) external;
    function switchToStreamModel(uint256 entityId, uint64 start, uint32 duration) external;

    function updateEntityCommission(uint256 entityId, uint256 newCommissionRate) external;
    function claimCommission(uint256 entityId) external;
    function entityCommissionRate(uint256 entityId) external view returns (uint256);
    function entityAccruedCommission(uint256 entityId) external view returns (uint256);

    // Get entities
    function activeEntitiesValues() external view returns (uint256[] memory);

    function updateEntityPool(uint256 entityId, uint256 shares, uint256 amount, bool isStake) external;
    function returnForfeitedRewards(uint256 entityId, uint256 amount) external;
    function redelegateDistributedRewards(uint256 fromEntityId, uint256 toEntityId, uint256 amount) external;

    function calculateYield(uint256 apy, uint256 principal, uint256 time) external pure returns (uint256);

    function calculateContinuousAPYByEntity(uint256 entityId) external view returns (uint256);

    function currentAPYByEntity(uint256 entityId) external view returns (uint256);
}
