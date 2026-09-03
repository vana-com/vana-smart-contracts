// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPortabilityServersV2.sol";

/**
 * @title Storage for DataPortabilityServersV2
 * @notice For future upgrades, do not change DataPortabilityServersV2StorageV1.
 * Create a new contract which implements DataPortabilityServersV2StorageV1.
 */
abstract contract DataPortabilityServersV2StorageV1 is IDataPortabilityServersV2 {
    /// @dev Storage shape for a server record. Returned externally as `ServerInfo`.
    struct Server {
        address ownerAddress;
        address serverAddress;
        string publicKey;
        string serverUrl;
        uint256 registeredAtBlock;
        uint256 revokedAtBlock; // 0 while active
    }

    /// @dev Trusted forwarder for ERC-2771 meta-transactions.
    address internal _trustedForwarder;

    /// @dev Monotonic count of every server ever registered.
    uint256 public override serversCount;

    /// @dev Server records keyed by deterministic id.
    mapping(bytes32 serverId => Server) internal _servers;

    /// @dev Active `serverId` per `serverAddress`. `bytes32(0)` if no active
    ///      registration. Cleared on revoke so the address can be re-registered.
    mapping(address serverAddress => bytes32) public override activeServerId;

    /// @dev All server ids ever registered by an owner, in registration order
    ///      (append-only, includes revoked entries).
    mapping(address ownerAddress => bytes32[]) internal _ownerToServerIds;
}
