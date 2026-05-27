// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPortabilityPermissionsV2.sol";

/**
 * @title Storage for DataPortabilityPermissionsV2
 * @notice For future upgrades, do not change DataPortabilityPermissionsV2StorageV1.
 * Create a new contract which implements DataPortabilityPermissionsV2StorageV1.
 */
abstract contract DataPortabilityPermissionsV2StorageV1 is IDataPortabilityPermissionsV2 {
    /// @dev Permissions keyed by deterministic grant id (keccak256(domain, grantor, granteeId)).
    /// @dev Replay/rollback protection is via `grantVersion` monotonicity per id —
    ///      no separate nonce counter is needed.
    mapping(bytes32 id => Permission) internal _permissions;
}
