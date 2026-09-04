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

    /// @notice One access record for `recordDataAccessBatch`. Field-for-field
    ///         the parameter list of `recordDataAccess`; the EIP-712 payload
    ///         the server signs is unchanged (`RECORD_ACCESS_TYPEHASH`).
    struct AccessRecord {
        address ownerAddress;
        string scope;
        uint256 version;
        address accessor;
        bytes32 recordId;
        bytes signature;
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
    error EmptyBatch();
    error BatchTooLarge(uint256 size, uint256 max);

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

    /// @notice Emitted by `recordDataAccessBatch` for every item it did NOT
    ///         record. `reason` is the 4-byte selector of the error the
    ///         single-record `recordDataAccess` would have reverted with for
    ///         the same input: `RecordIdAlreadyUsed`, `InvalidSignature`,
    ///         `UntrustedServer` or `UnknownVersion` — plus `ScopeTooLong`
    ///         for a scope above the registry's 256-byte cap, which the batch
    ///         path rejects before hashing (no data point can carry such a
    ///         scope, so the single path would end in `UnknownVersion` or
    ///         `UntrustedServer` after doing the work). Exactly one of
    ///         `DataAccessRecorded` / `DataAccessSkipped` is emitted per item,
    ///         so a receipt alone tells which recordIds landed.
    /// @param recordId Caller-chosen id of the skipped item.
    /// @param index    Position of the item in the submitted batch.
    /// @param reason   Error selector, see above.
    event DataAccessSkipped(bytes32 indexed recordId, uint256 index, bytes4 reason);

    /// @notice Emitted alongside `DataVersionAdded` when the EIP-712 signature
    ///         on `addDataWithSignature` was produced by a delegate (personal
    ///         server currently trusted by `ownerAddress`) rather than the
    ///         owner directly. Not emitted for direct `addData` or owner-self-
    ///         signed `addDataWithSignature` calls.
    event DataSignedByDelegate(bytes32 indexed id, address indexed ownerAddress, address indexed delegate);

    /// @notice Emitted alongside `DataPointStatusChanged` when the EIP-712
    ///         signature on `setStatusWithSignature` was produced by a delegate
    ///         (personal server currently trusted by `ownerAddress`). Not
    ///         emitted for direct `setStatus` or owner-self-signed calls.
    event StatusSignedByDelegate(bytes32 indexed id, address indexed ownerAddress, address indexed delegate);

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

    /// @notice Hard cap on `recordDataAccessBatch` length. A gas bound, not a
    ///         semantic one: sized so a full batch fits a 60M-gas block with
    ///         margin. Batches above it revert with `BatchTooLarge`.
    function MAX_ACCESS_BATCH() external view returns (uint256);

    /// @notice EIP-712 typehash for `setStatusWithSignature`. Type:
    ///         SetStatus(address ownerAddress,string scope,uint8 newStatus,
    ///         uint256 expectedSequence)
    function SET_STATUS_TYPEHASH() external view returns (bytes32);

    /// @notice Monotonic per-`(owner, scope)` counter that gates
    ///         `setStatusWithSignature` (signer must commit to `currentSequence + 1`).
    ///         Independent of `currentVersion` so status flips do not require
    ///         a data write. Starts at 0; first signed flip uses sequence 1.
    function statusSequence(address ownerAddress, string calldata scope)
        external view returns (uint256);

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

    /// @notice Flip the status of a data point on behalf of `ownerAddress` via
    ///         an EIP-712 signature. Same dual-signer model as
    ///         `addDataWithSignature`: the signature is accepted from EITHER
    ///         the owner OR a personal server currently registered to the
    ///         owner in `dataPortabilityServers`. If the servers contract is
    ///         unset, only owner-self-signed signatures are accepted.
    /// @dev    Replay/rollback protection: `expectedSequence` must equal the
    ///         current `statusSequence(owner, scope) + 1`. The sequence is
    ///         independent of `currentVersion` so flipping status does not
    ///         require a data write, and a write does not invalidate pending
    ///         status signatures.
    ///
    ///         Reverts with:
    ///           - `InvalidStatus` if `newStatus == Status.None`
    ///           - `DataPointNotFound` if no data point exists at `(owner, scope)`
    ///           - `UnexpectedVersion(expected, actual)` on sequence mismatch
    ///             (reusing the `UnexpectedVersion` error keeps the surface
    ///             tight; `expected` is the next sequence, `actual` is what
    ///             the caller supplied)
    ///           - `InvalidSignature` / `OwnerMismatch` as in `addDataWithSignature`
    ///
    ///         Same silent-no-op semantic as direct `setStatus` when the
    ///         status is already the requested value — the sequence is still
    ///         consumed so the signature cannot be replayed.
    /// @param  ownerAddress     Data point owner.
    /// @param  scope            Data point scope.
    /// @param  newStatus        Target status (must not be `Status.None`).
    /// @param  expectedSequence Must equal `statusSequence(owner, scope) + 1`.
    /// @param  signature        EIP-712 signature over the SetStatus payload.
    function setStatusWithSignature(
        address ownerAddress,
        string calldata scope,
        Status newStatus,
        uint256 expectedSequence,
        bytes calldata signature
    ) external;

    // ====================== Writes (delegated, EIP-712 signed) ======================

    /// @notice Write on behalf of `ownerAddress`. Authority comes from the
    ///         EIP-712 signature, which is accepted from EITHER:
    ///           (a) `ownerAddress` itself, OR
    ///           (b) a personal server currently registered to `ownerAddress`
    ///               in the configured `dataPortabilityServers` registry —
    ///               server-as-delegate. Identical trust model to
    ///               `recordDataAccess`: revoking the server in the servers
    ///               registry immediately removes signing authority.
    ///         If `dataPortabilityServers` is unset (zero address), only (a) is
    ///         accepted; behavior matches the pre-upgrade contract exactly.
    ///         In case (b), `DataSignedByDelegate` is emitted alongside the
    ///         standard `DataVersionAdded` / `DataPointCreated` events.
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

    /// @notice Record up to `MAX_ACCESS_BATCH` accesses in one call.
    ///         Skip-and-emit per item: each record is validated exactly as
    ///         `recordDataAccess` validates its arguments, in the same order.
    ///         A record that passes is committed and emits
    ///         `DataAccessRecorded`, identical to the single-record path. A
    ///         record that fails is skipped, emits `DataAccessSkipped` with
    ///         the selector of the error the single-record path would have
    ///         raised, and does not touch state. Items are independent: a
    ///         skipped item never affects another item, and a duplicate
    ///         recordId within the batch records the first occurrence and
    ///         skips the rest.
    /// @dev    Batch-level preconditions revert the whole call, as they would
    ///         a single call: caller lacks ACCESS_RECORDER_ROLE, contract
    ///         paused, `dataPortabilityServers` unset. Additionally an empty
    ///         batch reverts with `EmptyBatch` and an oversized one with
    ///         `BatchTooLarge`.
    ///
    ///         Each record carries its own server signature over its own
    ///         payload; there is no batch-level signature. A malformed
    ///         signature (wrong length, high-s, zero recovery) is reported as
    ///         `InvalidSignature` rather than the ECDSA library's typed
    ///         errors, so the batch path never reverts on one bad item.
    ///         Signature length and scope length are checked on calldata
    ///         before any hashing or memory copy, so an oversized item costs
    ///         the caller its calldata and a skip event, nothing more.
    /// @param  records  Records to process, in order.
    /// @return recorded `recorded[i]` is true iff `records[i]` was committed.
    function recordDataAccessBatch(AccessRecord[] calldata records)
        external
        returns (bool[] memory recorded);
}
