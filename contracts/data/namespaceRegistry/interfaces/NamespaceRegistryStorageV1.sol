// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./INamespaceRegistry.sol";

/**
 * @title Storage for NamespaceRegistry
 * @notice For future upgrades, do not change NamespaceRegistryStorageV1. Create a new
 * contract which implements NamespaceRegistryStorageV1.
 */
abstract contract NamespaceRegistryStorageV1 is INamespaceRegistry {
    mapping(bytes32 id => Namespace) internal _namespaces;
}
