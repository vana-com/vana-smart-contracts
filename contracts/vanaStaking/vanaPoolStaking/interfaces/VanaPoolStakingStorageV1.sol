// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IVanaPoolStaking.sol";

/**
 * @title Storage for VanaPool
 * @notice For future upgrades, do not change VanaPoolStorageV1. Create a new
 * contract which implements VanaPoolStorageV1
 */
abstract contract VanaPoolStakingStorageV1 is IVanaPoolStaking {
    address internal _trustedForwarder;

    IVanaPoolEntity public override vanaPoolEntity;
    IVanaPoolTreasury public override vanaPoolTreasury;

    uint256 public override minStakeAmount;

    EnumerableSet.AddressSet internal _activeStakersList;
    mapping(address => Staker) internal _stakers;
    EnumerableSet.AddressSet internal _inactiveStakersList;
}
