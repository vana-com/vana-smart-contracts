// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/DataRegistryV2StorageV1.sol";

/**
 * @title DataRegistryV2Implementation
 * @notice Scope-first data point registry. UUPS upgradeable.
 *
 *         See `IDataRegistryV2` for the full contract; this implementation
 *         enforces:
 *           - one data point per (owner, scope)
 *           - upsert semantics on `addData` (auto-revives Inactive/Unavailable)
 *           - `recordDataAccess` is gated by ACCESS_RECORDER_ROLE AND requires an
 *             EIP-712 signature from one of the owner's trusted personal
 *             servers (verified via DataPortabilityServers)
 *           - `recordDataAccessBatch` applies the same checks per item and
 *             skips (never reverts on) a failing item — see IDataRegistryV2
 *           - EIP-712 delegated writes via `addDataWithSignature` with
 *             per-data-point version monotonicity for replay protection
 */
contract DataRegistryV2Implementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    EIP712Upgradeable,
    DataRegistryV2StorageV1
{
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    string private constant SIGNING_DOMAIN = "Vana Data Portability";
    string private constant SIGNATURE_VERSION = "1";

    /// @dev Soft cap on scope string length to prevent gas griefing on the
    ///      single SSTORE for the `scope` field.
    uint256 private constant MAX_SCOPE_BYTES = 256;

    /// @notice Role required to submit `recordDataAccess` / `recordDataAccessBatch` calls.
    bytes32 public constant ACCESS_RECORDER_ROLE = keccak256("ACCESS_RECORDER_ROLE");

    /// @inheritdoc IDataRegistryV2
    uint256 public constant override MAX_ACCESS_BATCH = 200;

    bytes32 public constant override ADD_DATA_TYPEHASH =
        keccak256(
            "AddData(address ownerAddress,string scope,bytes32 dataHash,bytes32 metadataHash,uint256 expectedVersion)"
        );

    bytes32 public constant override RECORD_ACCESS_TYPEHASH =
        keccak256(
            "RecordDataAccess(address ownerAddress,string scope,uint256 version,address accessor,bytes32 recordId)"
        );

    bytes32 public constant override SET_STATUS_TYPEHASH =
        keccak256(
            "SetStatus(address ownerAddress,string scope,uint8 newStatus,uint256 expectedSequence)"
        );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress) external initializer {
        if (ownerAddress == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    // ====================== Admin ======================

    function pause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setDataPortabilityServers(address newDataPortabilityServers)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newDataPortabilityServers == address(0)) revert ZeroAddress();
        address previous = address(dataPortabilityServers);
        dataPortabilityServers = IDataPortabilityServersV2(newDataPortabilityServers);
        emit DataPortabilityServersUpdated(previous, newDataPortabilityServers);
    }

    // ====================== Pure helpers ======================

    function dataPointId(address ownerAddress, string calldata scope)
        public
        pure
        override
        returns (bytes32)
    {
        return _dataPointId(ownerAddress, scope);
    }

    function computeCommitment(bytes32 dataHash, bytes32 metadataHash)
        external
        pure
        override
        returns (bytes32)
    {
        return keccak256(abi.encode(dataHash, metadataHash));
    }

    // ====================== Views ======================

    function dataPoints(address ownerAddress, string calldata scope)
        external
        view
        override
        returns (DataPointInfo memory)
    {
        return dataPointById(_dataPointId(ownerAddress, scope));
    }

    function dataPointById(bytes32 id) public view override returns (DataPointInfo memory) {
        DataPoint storage d = _dataPoints[id];
        return
            DataPointInfo({
                id: id,
                owner: d.owner,
                scope: d.scope,
                status: d.status,
                currentVersion: d.currentVersion,
                currentCommitment: d.commitments[d.currentVersion],
                createdAt: d.createdAt,
                modifiedAt: d.modifiedAt,
                totalAccesses: d.totalAccesses
            });
    }

    function dataCommitment(address ownerAddress, string calldata scope, uint256 version_)
        external
        view
        override
        returns (bytes32)
    {
        return _dataPoints[_dataPointId(ownerAddress, scope)].commitments[version_];
    }

    function currentCommitment(address ownerAddress, string calldata scope)
        external
        view
        override
        returns (bytes32)
    {
        DataPoint storage d = _dataPoints[_dataPointId(ownerAddress, scope)];
        return d.commitments[d.currentVersion];
    }

    function currentVersion(address ownerAddress, string calldata scope)
        external
        view
        override
        returns (uint256)
    {
        return _dataPoints[_dataPointId(ownerAddress, scope)].currentVersion;
    }

    function accessCount(address ownerAddress, string calldata scope, uint256 version_)
        external
        view
        override
        returns (uint256)
    {
        return _dataPoints[_dataPointId(ownerAddress, scope)].accessesByVersion[version_];
    }

    function totalAccesses(address ownerAddress, string calldata scope)
        external
        view
        override
        returns (uint256)
    {
        return _dataPoints[_dataPointId(ownerAddress, scope)].totalAccesses;
    }

    function scopeDataPointsCount(string calldata scope) external view override returns (uint256) {
        return _dataPointsByScope[keccak256(bytes(scope))].length();
    }

    function scopeDataPointIdAt(string calldata scope, uint256 index)
        external
        view
        override
        returns (bytes32)
    {
        return _dataPointsByScope[keccak256(bytes(scope))].at(index);
    }

    function scopeDataPointIds(
        string calldata scope,
        uint256 offset,
        uint256 limit
    ) external view override returns (bytes32[] memory) {
        EnumerableSet.Bytes32Set storage set = _dataPointsByScope[keccak256(bytes(scope))];
        uint256 total = set.length();
        if (offset >= total) {
            return new bytes32[](0);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;
        bytes32[] memory result = new bytes32[](size);
        for (uint256 i = 0; i < size; ) {
            result[i] = set.at(offset + i);
            unchecked {
                ++i;
            }
        }
        return result;
    }

    function isRecordIdUsed(bytes32 recordId) external view override returns (bool) {
        return _usedRecordIds[recordId];
    }

    function statusSequence(address ownerAddress, string calldata scope)
        external
        view
        override
        returns (uint256)
    {
        return _statusSequences[_dataPointId(ownerAddress, scope)];
    }

    // ====================== Writes (direct) ======================

    function addData(string calldata scope, bytes32 dataHash, bytes32 metadataHash)
        external
        override
        whenNotPaused
        returns (bytes32 id, uint256 version_)
    {
        return _addData(msg.sender, scope, dataHash, metadataHash);
    }

    function setStatus(string calldata scope, Status newStatus) external override whenNotPaused {
        if (newStatus == Status.None) revert InvalidStatus();

        bytes32 id = _dataPointId(msg.sender, scope);
        DataPoint storage d = _dataPoints[id];
        if (d.currentVersion == 0) revert DataPointNotFound(id);
        if (d.status == newStatus) return; // silent no-op

        d.status = newStatus;
        d.modifiedAt = uint64(block.timestamp);
        emit DataPointStatusChanged(id, newStatus);
    }

    // ====================== Writes (signed, delegated) ======================

    function addDataWithSignature(
        address ownerAddress,
        string calldata scope,
        bytes32 dataHash,
        bytes32 metadataHash,
        uint256 expectedVersion,
        bytes calldata signature
    ) external override whenNotPaused returns (bytes32 id, uint256 version_) {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ADD_DATA_TYPEHASH,
                    ownerAddress,
                    keccak256(bytes(scope)),
                    dataHash,
                    metadataHash,
                    expectedVersion
                )
            )
        );

        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0)) revert InvalidSignature();

        // Two accepted authorities, identical to `addPermissionWithSignature`:
        //   1. Owner self-signed — original V2 behavior.
        //   2. Delegate — a personal server currently registered to the owner
        //      in `dataPortabilityServers`. Trust is evaluated at execution
        //      time; revocation in the servers registry immediately removes
        //      signing authority.
        // When `dataPortabilityServers` is unset, only path 1 is accepted —
        // preserves pre-upgrade behavior bit-for-bit.
        bool isOwner = signer == ownerAddress;
        bool isDelegate = !isOwner
            && address(dataPortabilityServers) != address(0)
            && _isTrustedServer(ownerAddress, signer);
        if (!isOwner && !isDelegate) revert OwnerMismatch(ownerAddress, signer);

        // Replay + rollback protection: signer must commit to the exact next
        // version. If anyone (the same owner via the direct path, or another
        // signature) raced ahead, this reverts.
        bytes32 idCheck = _dataPointId(ownerAddress, scope);
        uint256 nextVersion = uint256(_dataPoints[idCheck].currentVersion) + 1;
        if (expectedVersion != nextVersion) revert UnexpectedVersion(nextVersion, expectedVersion);

        (id, version_) = _addData(ownerAddress, scope, dataHash, metadataHash);
        if (isDelegate) emit DataSignedByDelegate(id, ownerAddress, signer);
    }

    /// @inheritdoc IDataRegistryV2
    /// @dev Mirrors `addDataWithSignature`'s dual-signer + monotonic-counter
    ///      pattern, against `_statusSequences` instead of `currentVersion` so
    ///      data writes and status flips can't invalidate each other's
    ///      pending signatures. The sequence is consumed even on the
    ///      silent-no-op case (status already equals newStatus) so the
    ///      signature can never be replayed.
    function setStatusWithSignature(
        address ownerAddress,
        string calldata scope,
        Status newStatus,
        uint256 expectedSequence,
        bytes calldata signature
    ) external override whenNotPaused {
        if (newStatus == Status.None) revert InvalidStatus();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SET_STATUS_TYPEHASH,
                    ownerAddress,
                    keccak256(bytes(scope)),
                    uint8(newStatus),
                    expectedSequence
                )
            )
        );

        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0)) revert InvalidSignature();

        bool isOwner = signer == ownerAddress;
        bool isDelegate = !isOwner
            && address(dataPortabilityServers) != address(0)
            && _isTrustedServer(ownerAddress, signer);
        if (!isOwner && !isDelegate) revert OwnerMismatch(ownerAddress, signer);

        bytes32 id = _dataPointId(ownerAddress, scope);
        DataPoint storage d = _dataPoints[id];
        if (d.currentVersion == 0) revert DataPointNotFound(id);

        uint256 nextSequence = _statusSequences[id] + 1;
        if (expectedSequence != nextSequence) revert UnexpectedVersion(nextSequence, expectedSequence);
        _statusSequences[id] = nextSequence;

        // Status already at target: counter is consumed (anti-replay), but no
        // state mutation and no event — matches direct setStatus's silent
        // no-op semantics on the status side.
        if (d.status == newStatus) {
            if (isDelegate) emit StatusSignedByDelegate(id, ownerAddress, signer);
            return;
        }

        d.status = newStatus;
        d.modifiedAt = uint64(block.timestamp);
        emit DataPointStatusChanged(id, newStatus);
        if (isDelegate) emit StatusSignedByDelegate(id, ownerAddress, signer);
    }

    // ====================== Access recording ======================

    function recordDataAccess(
        address ownerAddress,
        string calldata scope,
        uint256 version_,
        address accessor,
        bytes32 recordId,
        bytes calldata signature
    ) external override whenNotPaused onlyRole(ACCESS_RECORDER_ROLE) {
        if (address(dataPortabilityServers) == address(0)) revert DataPortabilityServersNotSet();
        if (_usedRecordIds[recordId]) revert RecordIdAlreadyUsed(recordId);

        // Recover the signer (must be one of the owner's trusted personal servers).
        address server = ECDSA.recover(
            _recordAccessDigest(ownerAddress, scope, version_, accessor, recordId),
            signature
        );
        if (server == address(0)) revert InvalidSignature();
        if (!_isTrustedServer(ownerAddress, server)) revert UntrustedServer(ownerAddress, server);

        bytes32 id = _dataPointId(ownerAddress, scope);
        DataPoint storage d = _dataPoints[id];
        if (version_ == 0 || version_ > d.currentVersion) revert UnknownVersion(id, version_);

        _commitAccess(d, id, version_, accessor, server, recordId);
    }

    /// @inheritdoc IDataRegistryV2
    /// @dev Same checks as `recordDataAccess`, in the same order, but a
    ///      failing check skips the item (emitting `DataAccessSkipped` with
    ///      the selector `recordDataAccess` would have reverted with) instead
    ///      of reverting the call. `ECDSA.tryRecover` replaces `recover` so a
    ///      malformed signature cannot abort the batch; every recover error
    ///      maps to `InvalidSignature`. State is only written through
    ///      `_commitAccess`, shared with the single-record path, so a batch of
    ///      one and a single call produce identical state and identical
    ///      `DataAccessRecorded` events.
    function recordDataAccessBatch(AccessRecord[] calldata records)
        external
        override
        whenNotPaused
        onlyRole(ACCESS_RECORDER_ROLE)
        returns (bool[] memory recorded)
    {
        if (address(dataPortabilityServers) == address(0)) revert DataPortabilityServersNotSet();
        uint256 len = records.length;
        if (len == 0) revert EmptyBatch();
        if (len > MAX_ACCESS_BATCH) revert BatchTooLarge(len, MAX_ACCESS_BATCH);

        recorded = new bool[](len);
        for (uint256 i = 0; i < len; ) {
            AccessRecord calldata r = records[i];
            bytes4 reason = _tryRecordAccess(r);
            if (reason == bytes4(0)) {
                recorded[i] = true;
            } else {
                emit DataAccessSkipped(r.recordId, i, reason);
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev One item of `recordDataAccessBatch`. Returns `bytes4(0)` and
    ///      commits the access when every check passes; otherwise returns the
    ///      selector of the error the single-record path raises for the same
    ///      failure and leaves state untouched. Check order mirrors
    ///      `recordDataAccess`: recordId reuse, signature, trusted server,
    ///      version.
    function _tryRecordAccess(AccessRecord calldata r) internal returns (bytes4) {
        if (_usedRecordIds[r.recordId]) return RecordIdAlreadyUsed.selector;

        (address server, ECDSA.RecoverError err, ) = ECDSA.tryRecover(
            _recordAccessDigest(r.ownerAddress, r.scope, r.version, r.accessor, r.recordId),
            r.signature
        );
        if (err != ECDSA.RecoverError.NoError || server == address(0)) return InvalidSignature.selector;
        if (!_isTrustedServer(r.ownerAddress, server)) return UntrustedServer.selector;

        bytes32 id = _dataPointId(r.ownerAddress, r.scope);
        DataPoint storage d = _dataPoints[id];
        if (r.version == 0 || r.version > d.currentVersion) return UnknownVersion.selector;

        _commitAccess(d, id, r.version, r.accessor, server, r.recordId);
        return bytes4(0);
    }

    /// @dev EIP-712 digest a trusted server signs for one access record.
    function _recordAccessDigest(
        address ownerAddress,
        string calldata scope,
        uint256 version_,
        address accessor,
        bytes32 recordId
    ) internal view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        RECORD_ACCESS_TYPEHASH,
                        ownerAddress,
                        keccak256(bytes(scope)),
                        version_,
                        accessor,
                        recordId
                    )
                )
            );
    }

    /// @dev The single state-mutating tail shared by `recordDataAccess` and
    ///      `recordDataAccessBatch`: marks the recordId used, bumps both
    ///      counters, emits `DataAccessRecorded`. Callers have already
    ///      validated the record.
    function _commitAccess(
        DataPoint storage d,
        bytes32 id,
        uint256 version_,
        address accessor,
        address server,
        bytes32 recordId
    ) internal {
        _usedRecordIds[recordId] = true;

        uint256 newVersionCount;
        uint256 newTotal;
        unchecked {
            newVersionCount = d.accessesByVersion[version_] + 1;
            newTotal = d.totalAccesses + 1;
        }
        d.accessesByVersion[version_] = newVersionCount;
        d.totalAccesses = newTotal;

        emit DataAccessRecorded(id, version_, accessor, server, recordId, newVersionCount, newTotal);
    }

    /// @dev Checks DataPortabilityServersV2 to confirm `server` has an active
    ///      registration AND that registration's owner is `ownerAddress`.
    ///      In V2 a server address has at most one active owner at a time.
    function _isTrustedServer(address ownerAddress, address server) internal view returns (bool) {
        bytes32 sId = dataPortabilityServers.activeServerId(server);
        if (sId == bytes32(0)) return false;
        IDataPortabilityServersV2.ServerInfo memory info = dataPortabilityServers.getServer(sId);
        return info.ownerAddress == ownerAddress;
    }

    // ====================== Internals ======================

    function _dataPointId(address ownerAddress, string calldata scope) internal pure returns (bytes32) {
        return keccak256(abi.encode(ownerAddress, scope));
    }

    function _addData(
        address ownerAddress,
        string calldata scope,
        bytes32 dataHash,
        bytes32 metadataHash
    ) internal returns (bytes32 id, uint256 version_) {
        if (ownerAddress == address(0)) revert ZeroAddress();
        uint256 scopeLen = bytes(scope).length;
        if (scopeLen == 0) revert EmptyScope();
        if (scopeLen > MAX_SCOPE_BYTES) revert ScopeTooLong();

        id = _dataPointId(ownerAddress, scope);
        DataPoint storage d = _dataPoints[id];
        bytes32 commitment = keccak256(abi.encode(dataHash, metadataHash));

        if (d.currentVersion == 0) {
            // First write: create.
            d.owner = ownerAddress;
            d.scope = scope;
            d.status = Status.Active;
            d.createdAt = uint64(block.timestamp);
            version_ = 1;

            _dataPointsByScope[keccak256(bytes(scope))].add(id);
            emit DataPointCreated(id, ownerAddress, keccak256(bytes(scope)), scope);
        } else {
            // Append.
            unchecked {
                version_ = uint256(d.currentVersion) + 1;
            }
            // Auto-revive Inactive/Unavailable on new data.
            if (d.status != Status.Active) {
                d.status = Status.Active;
                emit DataPointStatusChanged(id, Status.Active);
            }
        }

        d.currentVersion = uint64(version_);
        d.modifiedAt = uint64(block.timestamp);
        d.commitments[version_] = commitment;

        emit DataVersionAdded(id, version_, dataHash, metadataHash, commitment);
    }
}
