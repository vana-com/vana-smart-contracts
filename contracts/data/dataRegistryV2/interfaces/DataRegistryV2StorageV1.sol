// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataRegistryV2.sol";

/**
 * @title Storage for DataRegistryV2
 * @notice For future upgrades, do not change DataRegistryV2StorageV1. Create a new
 * contract which implements DataRegistryV2StorageV1.
 */
abstract contract DataRegistryV2StorageV1 is IDataRegistryV2 {
    IScopeRegistry public override scopeRegistry;

    uint256 public override dataPointsCount;

    mapping(uint256 id => DataPoint) internal _dataPoints;
}
