// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../../dataPortability/dataPortabilityServersV2/interfaces/IDataPortabilityServersV2.sol";

/**
 * @title IDataRegistryV2
 * @author Vana Network
 * @notice Scope-first data point registry. Each data point is identified by
 *         `keccak256(abi.encode(owner, scope))` (content-addressed), carries a
 *         monotonically increasing version, and tracks per-version + total
 *         access counters.
 *
 *         Each (owner, scope) maps to exactly one data point. Multiple
 *         "states" of the same data point are expressed as versions — calling
 *         `addData` again with the same scope appends a new version rather
 *         than creating a new record.
 *
 *         Access recording uses layered auth:
 *           - Caller must hold ACCESS_RECORDER_ROLE on this contract.
 *           - The signed payload must be authored by a "personal server" that
 *             the data owner has registered + trusts in DataPortabilityServers.
 *
 *         Signature-based delegation: `addDataWithSignature` lets a relayer
 *         submit a write on behalf of an owner who signed the EIP-712 payload.
 *         Replay/rollback protection is per-data-point: the signer commits to
 *         `expectedVersion`, which must equal `currentVersion + 1`.
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

    /// @dev Memory-safe view of a data point (omits the per-version mappings).
    struct DataPointInfo {
        bytes32 id;
        address owner;
        string scope;
        Status status;
        uint256 currentVersion;
        bytes32 currentCommitment;
        uint256 createdAt;
        uint256 modifiedAt;
        uint256 totalAccesses;
    }

    // ====================== Errors ======================

    error ZeroAddress();
    error EmptyScope();
    error ScopeTooLong();
    error OwnerMismatch(address claimed, address actual);
    error DataPointNotFound(bytes32 id);
    error InvalidStatus();
    error UnknownVersion(bytes32 id, uint256 version);
    error UnexpectedVersion(uint256 expected, uint256 actual);
    error InvalidSignature();
    error DataPortabilityServersNotSet();
    error UntrustedServer(address owner, address server);
    error RecordIdAlreadyUsed(bytes32 recordId);

    // ====================== Events ======================

    event DataPointCreated(
        bytes32 indexed id,
        address indexed owner,
        bytes32 indexed scopeHash,
        string scope
    );

    event DataVersionAdded(
        bytes32 indexed id,
        uint256 indexed version,
        bytes32 dataHash,
        bytes32 metadataHash,
        bytes32 dataCommitment
    );

    event DataPointStatusChanged(bytes32 indexed id, Status indexed newStatus);

    event DataAccessRecorded(
        bytes32 indexed id,
        uint256 indexed version,
        address indexed accessor,
        address server,
        bytes32 recordId,
        uint256 versionAccessCount,
        uint256 dataPointTotalAccesses
    );

    event DataPortabilityServersUpdated(address indexed previous, address indexed current);

    // ====================== Pure helpers ======================

    function version() external pure returns (uint256);

    /// @notice Deterministic id for a (owner, scope) pair.
    function dataPointId(address ownerAddress, string calldata scope) external pure returns (bytes32);

    /// @notice keccak256(abi.encode(dataHash, metadataHash))
    function computeCommitment(bytes32 dataHash, bytes32 metadataHash) external pure returns (bytes32);

    /// @notice EIP-712 typehash for `addDataWithSignature`. Type:
    ///         AddData(address ownerAddress,string scope,bytes32 dataHash,
    ///         bytes32 metadataHash,uint256 expectedVersion)
    function ADD_DATA_TYPEHASH() external view returns (bytes32);

    /// @notice EIP-712 typehash for `recordDataAccess`. Type:
    ///         RecordDataAccess(address ownerAddress,string scope,uint256 version,
    ///         address accessor,bytes32 recordId)
    function RECORD_ACCESS_TYPEHASH() external view returns (bytes32);

    // ====================== Views ======================

    /// @notice Cross-referenced personal-servers registry used to authorize
    ///         signers of `recordDataAccess`. Set post-deploy via
    ///         `setDataPortabilityServers` (admin-only).
    function dataPortabilityServers() external view returns (IDataPortabilityServersV2);

    function dataPoints(address ownerAddress, string calldata scope) external view returns (DataPointInfo memory);

    /// @notice Look up a data point by its deterministic id directly.
    /// @dev For unregistered ids every field returns its zero default
    ///      (`info.owner == address(0)` signals "not found").
    function dataPointById(bytes32 id) external view returns (DataPointInfo memory);

    function dataCommitment(address ownerAddress, string calldata scope, uint256 version_)
        external view returns (bytes32);

    function currentCommitment(address ownerAddress, string calldata scope) external view returns (bytes32);

    function currentVersion(address ownerAddress, string calldata scope) external view returns (uint256);

    function accessCount(address ownerAddress, string calldata scope, uint256 version_)
        external view returns (uint256);

    function totalAccesses(address ownerAddress, string calldata scope) external view returns (uint256);

    function isRecordIdUsed(bytes32 recordId) external view returns (bool);

    // Scope enumeration — paginated.
    function scopeDataPointsCount(string calldata scope) external view returns (uint256);
    function scopeDataPointIdAt(string calldata scope, uint256 index) external view returns (bytes32);
    function scopeDataPointIds(
        string calldata scope,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory);

    // ====================== Admin ======================

    function pause() external;

    function unpause() external;

    /// @notice Set or update the DataPortabilityServers contract used to
    ///         authorize personal-server signers on `recordDataAccess`.
    function setDataPortabilityServers(address newDataPortabilityServers) external;

    // ====================== Writes (direct, msg.sender is owner) ======================

    /// @notice Create a new data point or append a new version to an existing one.
    ///         Auto-transitions status to Active if previously Inactive/Unavailable.
    /// @return id        Deterministic data point id.
    /// @return version_  New version number (1 if created, currentVersion+1 if appended).
    function addData(
        string calldata scope,
        bytes32 dataHash,
        bytes32 metadataHash
    ) external returns (bytes32 id, uint256 version_);

    function setStatus(string calldata scope, Status newStatus) external;

    // ====================== Writes (delegated, EIP-712 signed) ======================

    /// @notice Write on behalf of `ownerAddress`, who signed the EIP-712 payload.
    ///         `expectedVersion` must equal `currentVersion + 1` for the
    ///         (owner, scope) slot — both replay and rollback protection.
    function addDataWithSignature(
        address ownerAddress,
        string calldata scope,
        bytes32 dataHash,
        bytes32 metadataHash,
        uint256 expectedVersion,
        bytes calldata signature
    ) external returns (bytes32 id, uint256 version_);

    // ====================== Access recording ======================

    /// @notice Record one access against a specific version.
    /// @dev    Auth:
    ///           - msg.sender must hold ACCESS_RECORDER_ROLE on this contract.
    ///           - `signature` must recover to an address registered as a
    ///             trusted server of `ownerAddress` in DataPortabilityServers.
    ///         Replay protection: each `recordId` may only be used once.
    /// @param  ownerAddress  Data point owner whose counter is incremented.
    /// @param  scope         Data point scope.
    /// @param  version_      Version against which the access is recorded.
    /// @param  accessor      Address that performed the access.
    /// @param  recordId      Caller-chosen unique id; reverts if reused.
    /// @param  signature     EIP-712 signature by one of the owner's trusted
    ///                       personal servers over the record payload.
    function recordDataAccess(
        address ownerAddress,
        string calldata scope,
        uint256 version_,
        address accessor,
        bytes32 recordId,
        bytes calldata signature
    ) external;
}
