// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataRefinerRegistry.sol";

/**
 * @title Storage for DataRefinerRegistry
 * @notice For future upgrades, do not change DataRefinerRegistryStorageV1.
 * Create a new contract which implements DataRefinerRegistryStorageV1.
 */
abstract contract DataRefinerRegistryStorageV1 is IDataRefinerRegistry {
    IDLPRootCoreReadOnly public override dlpRootCore;
    uint256 public override refinersCount;
    
    mapping(uint256 refinerId => Refiner) internal _refiners;
}
