// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../scopeRegistry/interfaces/IScopeRegistry.sol";

/**
 * @title IDataRegistryV2
 * @author Vana Network
 * @notice Registry of data points keyed by a sequential id. Each data point
 *         is owned by a single address, scoped under a ScopeRegistry scope,
 *         and carries versioned metadata. Anyone may register their own data
 *         points; only the owner may update them.
 *
 *         A data point's metadata is a monotonic version history: every
 *         `updateMetadata` call increments `metadataVersion` and writes a new
 *         string under that version. Old versions remain readable.
 *
 *         Scope status is verified at registration time only — if a scope is
 *         deprecated after a data point is registered, existing data points
 *         remain unaffected.
 *
 * @custom:security-contact security@vana.org
 */
interface IDataRegistryV2 {
    enum Status {
        None,
        Active,
        Inactive,
        Unavailable
    }

    /// @dev Storage shape. Not returned from views because it contains a mapping.
    struct DataPoint {
        address owner;
        bytes32 scopeId;
        uint256 createdAt;
        uint256 modifiedAt;
        Status status;
        uint256 metadataVersion;
        mapping(uint256 version => string metadata) metadata;
    }

    /// @dev Memory-safe view of a data point (omits the metadata mapping).
    struct DataPointInfo {
        uint256 id;
        address owner;
        bytes32 scopeId;
        uint256 createdAt;
        uint256 modifiedAt;
        Status status;
        uint256 metadataVersion;
    }

    // ====================== Errors ======================

    error ZeroAddress();
    error EmptyMetadata();
    error ScopeNotActive(bytes32 scopeId);
    error DataPointNotFound(uint256 id);
    error NotDataPointOwner(uint256 id, address caller);
    error InvalidStatus();
    error InvalidVersion(uint256 id, uint256 version);
    error EmptyScopeRegistry();

    // ====================== Events ======================

    event DataPointRegistered(
        uint256 indexed id,
        address indexed owner,
        bytes32 indexed scopeId,
        string metadata
    );

    event DataPointMetadataUpdated(uint256 indexed id, uint256 indexed version, string metadata);

    event DataPointStatusChanged(uint256 indexed id, Status indexed status);

    event ScopeRegistryUpdated(address indexed previous, address indexed current);

    // ====================== Views ======================

    function version() external pure returns (uint256);

    function scopeRegistry() external view returns (IScopeRegistry);

    function dataPointsCount() external view returns (uint256);

    /// @notice Returns the memory-safe view of a data point. For metadata,
    ///         use `metadata(id)` or `metadataAt(id, version)`.
    function dataPoints(uint256 id) external view returns (DataPointInfo memory);

    /// @notice Latest metadata string for the data point.
    function metadata(uint256 id) external view returns (string memory);

    /// @notice Metadata at a specific version (1 = initial, monotonically increasing).
    function metadataAt(uint256 id, uint256 version_) external view returns (string memory);

    // ====================== Admin ======================

    function pause() external;

    function unpause() external;

    function updateScopeRegistry(address newScopeRegistry) external;

    // ====================== Mutations ======================

    /// @notice Register a new data point under `scopeId` with initial metadata.
    ///         Caller becomes the owner; status starts as Active.
    /// @return id The newly assigned data point id.
    function register(bytes32 scopeId, string calldata metadata_) external returns (uint256 id);

    /// @notice Append a new metadata version. Bumps `metadataVersion` and
    ///         updates `modifiedAt`. Caller must be the owner.
    function updateMetadata(uint256 id, string calldata metadata_) external;

    /// @notice Change the status of a data point. Caller must be the owner.
    ///         Cannot set to `None` (that's the unregistered sentinel).
    function setStatus(uint256 id, Status newStatus) external;
}
