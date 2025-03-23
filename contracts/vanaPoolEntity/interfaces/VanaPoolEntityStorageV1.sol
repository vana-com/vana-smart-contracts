// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IVanaPoolEntity.sol";

/**
 * @title Storage for VanaPoolEntity
 * @notice For future upgrades, do not change VanaPoolEntityStorageV1. Create a new
 * contract which implements VanaPoolEntityStorageV1
 */
abstract contract VanaPoolEntityStorageV1 is IVanaPoolEntity {
    IVanaPoolStaking public override vanaPoolStaking;

    uint256 public override entitiesCount;

    uint256 public override minRegistrationStake;
    uint256 public override maxAPYDefault;

    // Entity storage - all entity data is stored here
    mapping(uint256 entityId => Entity entity) internal _entities;
    mapping(string entityName => uint256 entityId) public override entityNameToId;

    EnumerableSet.UintSet internal _activeEntityIds; // Constants for calculations

    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant VANA_POOL_ROLE = keccak256("VANA_POOL_ROLE");
}
