// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./VanaPoolStakingStorageV2.sol";

/**
 * @title Storage for VanaPool
 * @notice For future upgrades, do not change VanaPoolStorageV3. Create a new
 * contract which implements VanaPoolStorageV3
 */
abstract contract VanaPoolStakingStorageV3 is VanaPoolStakingStorageV2 {
    // Registration-stake floor. The address that seeded an entity's shares at
    // creation, and the share count it must keep: an entity's totalShares can
    // therefore never fall below this, which keeps the price per share bounded
    // and rounding losses on later deposits at dust level. Bound to the
    // registrant, not the (transferable) entity owner, so ownership transfer
    // cannot release it. Entities created before this upgrade have no record
    // (registrant == address(0), no floor); for those the price cap in
    // VanaPoolEntity.updateEntityPool (MAX_ACTIVE_POOL_PER_SHARE) is the guard.
    mapping(uint256 entityId => address registrant) public override entityRegistrant;
    mapping(uint256 entityId => uint256 shares) public override entityRegistrationShares;
}
