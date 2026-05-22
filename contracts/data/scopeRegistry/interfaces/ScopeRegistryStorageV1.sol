// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IScopeRegistry.sol";

/**
 * @title Storage for ScopeRegistry
 * @notice For future upgrades, do not change ScopeRegistryStorageV1. Create a new
 * contract which implements ScopeRegistryStorageV1.
 */
abstract contract ScopeRegistryStorageV1 is IScopeRegistry {
    /// @dev Reference to the namespace registry used for owner / status checks.
    INamespaceRegistry public override namespaceRegistry;

    mapping(bytes32 id => Scope) internal _scopes;

    /// @dev All scope ids ever registered under a given namespace (includes
    ///      Deprecated). Use the `status` field on each scope to filter.
    mapping(bytes32 namespaceId => EnumerableSet.Bytes32Set) internal _scopesByNamespace;
}
