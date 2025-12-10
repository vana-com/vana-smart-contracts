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

    struct Entity {
        address ownerAddress;
        EntityStatus status;
        string name;
        uint256 maxAPY; // Maximum APY for this entity (in basis points, 1% = 100)
        uint256 lockedRewardPool; // Locked rewards for this entity
        uint256 activeRewardPool; // Active rewards available for distribution
        uint256 totalShares; // Total shares for this entity
        uint256 lastUpdateTimestamp; // When rewards were last processed
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
    }

    function entitiesCount() external view returns (uint256);
    function entities(uint256 entityId) external view returns (EntityInfo memory);
    function entityByName(string calldata entityName) external view returns (EntityInfo memory);
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
    function updateEntityMaxAPY(uint256 entityId, uint256 newMaxAPY) external;

    // Get entities
    function activeEntitiesValues() external view returns (uint256[] memory);

    function updateEntityPool(uint256 entityId, uint256 shares, uint256 amount, bool isStake) external;
    function returnForfeitedRewards(uint256 entityId, uint256 amount) external;

    function calculateYield(uint256 apy, uint256 principal, uint256 time) external pure returns (uint256);

    function calculateContinuousAPYByEntity(uint256 entityId) external view returns (uint256);
}
