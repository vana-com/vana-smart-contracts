// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IDataPortabilityServersV2
 * @author Vana Network
 * @notice Gateway-compatible server registry. Replaces the V1
 *         DataPortabilityServers model (auto-incrementing IDs, per-user trust
 *         windows, per-user nonces) with:
 *
 *           - **Deterministic bytes32 serverId** computed off-chain from
 *             (domainSeparator, serverAddress, publicKey, serverUrl) so the
 *             gateway can predict it at signing time.
 *           - **Single-owner servers**: a server address is owned by exactly
 *             one address per active registration. Registration and trust
 *             are the same event.
 *           - **One-shot revocation**: deregistering is terminal for that
 *             registration record, but the same serverAddress can be
 *             re-registered later with different (publicKey, serverUrl) to
 *             produce a fresh serverId.
 *           - **EIP-712-only writes**: no `*ByManager`, no separate
 *             trust/untrust, no `updateServer`. Identity is content-addressed,
 *             so updates would change the id.
 *
 *         EIP-712 signing domain is `"Vana Data Portability"`, version `"1"` —
 *         shared with the other Vana data-portability contracts.
 *
 * @custom:security-contact security@vana.org
 */
interface IDataPortabilityServersV2 {
    // ====================== Structs ======================

    /// @notice EIP-712 payload for registering a new server.
    ///         Signed by `ownerAddress` and verified inside
    ///         `registerServerWithSignature`.
    struct ServerRegistration {
        address ownerAddress;
        address serverAddress;
        string publicKey;
        string serverUrl;
    }

    /// @notice EIP-712 payload for revoking a previously registered server.
    ///         Signed by `ownerAddress`. `serverId` binds the revocation to
    ///         a specific registration instance so a replayed sig cannot
    ///         revoke a future re-registration that reuses `serverAddress`.
    struct ServerDeregistration {
        address ownerAddress;
        address serverAddress;
        bytes32 serverId;
        uint256 deadline;
    }

    /// @notice External view of a server record.
    struct ServerInfo {
        bytes32 id;
        address ownerAddress;
        address serverAddress;
        string publicKey;
        string serverUrl;
        uint256 registeredAtBlock;
        uint256 revokedAtBlock; // 0 while active
    }

    // ====================== Errors ======================

    error ZeroAddress();
    error EmptyPublicKey();
    error EmptyUrl();
    error ServerAlreadyRegistered(address serverAddress);
    error InvalidSignature();
    error OwnerMismatch(address claimed, address recovered);
    error ServerNotFound(bytes32 serverId);
    error NotServerOwner(bytes32 serverId, address claimed, address actual);
    error StaleServerId(bytes32 expected, bytes32 provided);
    error DeadlineExpired(uint256 deadline, uint256 currentTime);
    error AlreadyRevoked(bytes32 serverId);

    // ====================== Events ======================

    /// @notice Emitted when a new server is registered and trusted by an owner.
    /// @dev `publicKey` and `serverUrl` are unindexed so external indexers can
    ///      reconstruct the full record from logs alone, even though both can
    ///      exceed 32 bytes.
    event ServerRegistered(
        bytes32 indexed serverId,
        address indexed ownerAddress,
        address indexed serverAddress,
        string publicKey,
        string serverUrl
    );

    /// @notice Emitted when a server registration is revoked. Terminal per
    ///         registration instance; the owner can register the same
    ///         `serverAddress` again afterward to produce a new `serverId`.
    event ServerDeregistered(
        bytes32 indexed serverId,
        address indexed ownerAddress,
        address indexed serverAddress
    );

    // ====================== Pure / view helpers ======================

    function version() external pure returns (uint256);

    /// @notice EIP-712 domain separator. Exposed so off-chain code can predict
    ///         `serverId` ahead of submission.
    function domainSeparator() external view returns (bytes32);

    /// @notice Typehash for `ServerRegistration`.
    function SERVER_REGISTRATION_TYPEHASH() external view returns (bytes32);

    /// @notice Typehash for `ServerDeregistration`.
    function SERVER_DEREGISTRATION_TYPEHASH() external view returns (bytes32);

    /// @notice Deterministic id for a server. Anyone can compute this off-chain
    ///         with the same formula:
    ///         `keccak256(abi.encode(domainSeparator, serverAddress, publicKey, serverUrl))`.
    function computeServerId(
        address serverAddress,
        string calldata publicKey,
        string calldata serverUrl
    ) external view returns (bytes32);

    // ====================== Views ======================

    /// @notice Look up a server record by its deterministic id.
    /// @dev Reverts with `ServerNotFound` if no record exists for `serverId`.
    function getServer(bytes32 serverId) external view returns (ServerInfo memory);

    /// @notice The currently-active `serverId` for a given `serverAddress`,
    ///         or `bytes32(0)` if no active registration exists.
    function activeServerId(address serverAddress) external view returns (bytes32);

    /// @notice Look up the active registration for a server address.
    /// @dev Reverts with `ServerNotFound` if no non-revoked registration exists.
    function getActiveServerByAddress(address serverAddress)
        external
        view
        returns (ServerInfo memory);

    /// @notice Enumerate every server an owner has ever registered, in
    ///         registration order (active + revoked).
    function ownerServers(address ownerAddress) external view returns (ServerInfo[] memory);

    /// @notice Total number of server records ever registered.
    function serversCount() external view returns (uint256);

    function trustedForwarder() external view returns (address);

    // ====================== Admin ======================

    function pause() external;

    function unpause() external;

    function updateTrustedForwarder(address trustedForwarderAddress) external;

    // ====================== Writes ======================

    /// @notice Register a server with an EIP-712 signature from the owner.
    ///         The recovered signer must equal `input.ownerAddress`.
    ///         Computes `serverId`, stores the record, emits
    ///         `ServerRegistered`. Reverts if a server with the same
    ///         `serverAddress` is already active.
    function registerServerWithSignature(
        ServerRegistration calldata input,
        bytes calldata signature
    ) external returns (bytes32 serverId);

    /// @notice Deregister a server with an EIP-712 signature from the owner.
    ///         The recovered signer must equal `input.ownerAddress` AND match
    ///         the server's stored owner. `input.serverId` must equal the
    ///         stored id (ties revocation to a specific registration instance).
    ///         Reverts if `block.timestamp > input.deadline` or if the server
    ///         is already revoked.
    function deregisterServerWithSignature(
        ServerDeregistration calldata input,
        bytes calldata signature
    ) external;
}
