// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./VanaPoolStakingStorageV1.sol";

/**
 * @title Storage for VanaPool
 * @notice For future upgrades, do not change VanaPoolStorageV2. Create a new
 * contract which implements VanaPoolStorageV2
 */
abstract contract VanaPoolStakingStorageV2 is VanaPoolStakingStorageV1 {
    uint256 public override bondingPeriod; // Bonding period in seconds   
}
