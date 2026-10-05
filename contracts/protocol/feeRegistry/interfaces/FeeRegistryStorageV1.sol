// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IFeeRegistry.sol";

/**
 * @title Storage for FeeRegistry
 * @notice For future upgrades, do not change FeeRegistryStorageV1. Create a new
 * contract which implements FeeRegistryStorageV1.
 */
abstract contract FeeRegistryStorageV1 is IFeeRegistry {
    /// @dev Fee config keyed by `operation`. Unregistered operations return the zero-valued struct.
    mapping(bytes32 operation => Fee) internal _fees;

    /// @dev Set of all operations ever registered. An entry persists across
    ///      enable/disable toggles; it's only removed by `clearFee`.
    EnumerableSet.Bytes32Set internal _registeredOperations;
}
