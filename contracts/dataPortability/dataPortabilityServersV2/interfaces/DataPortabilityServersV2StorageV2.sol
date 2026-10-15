// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataPortabilityServersV2StorageV1.sol";

/**
 * @title Storage for DataPortabilityServersV2, version 2
 * @notice Appends to DataPortabilityServersV2StorageV1. Do not change it;
 * create a new contract which implements DataPortabilityServersV2StorageV2.
 */
abstract contract DataPortabilityServersV2StorageV2 is DataPortabilityServersV2StorageV1 {
    /// @dev When true, registration requires the server key's proof of
    ///      possession. False after the upgrade until the maintainer turns it on.
    bool public override requireServerProof;

    /// @dev Records registered with the server key's proof. A proven record
    ///      stays burnt after revocation, because its signature pair is public
    ///      calldata and could otherwise be replayed.
    mapping(bytes32 serverId => bool) internal _provenServerIds;

    /// @dev Unproven records the server key revoked. `registerServerWithProof`
    ///      may reuse such an id once, so a squat on the operator's exact
    ///      (publicKey, serverUrl) does not burn that tuple for the operator.
    mapping(bytes32 serverId => bool) internal _reclaimableServerIds;
}
