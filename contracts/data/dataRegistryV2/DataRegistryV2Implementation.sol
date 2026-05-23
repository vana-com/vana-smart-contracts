// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DataRegistryV2StorageV1.sol";

/**
 * @title DataRegistryV2Implementation
 * @notice Fresh data-point registry keyed by sequential ids, with versioned
 *         metadata per data point. UUPS upgradeable.
 *
 *         This is independent of the legacy `DataRegistry` (file-based). The
 *         two registries can coexist; consumers choose which one to read from.
 */
contract DataRegistryV2Implementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DataRegistryV2StorageV1
{
    /// @dev Reverts unless `msg.sender` owns the data point with `id`.
    modifier onlyDataPointOwner(uint256 id) {
        if (_dataPoints[id].status == Status.None) revert DataPointNotFound(id);
        if (_dataPoints[id].owner != msg.sender) revert NotDataPointOwner(id, msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, address scopeRegistryAddress) external initializer {
        if (ownerAddress == address(0)) revert ZeroAddress();
        if (scopeRegistryAddress == address(0)) revert EmptyScopeRegistry();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        scopeRegistry = IScopeRegistry(scopeRegistryAddress);

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

    function updateScopeRegistry(address newScopeRegistry) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newScopeRegistry == address(0)) revert EmptyScopeRegistry();
        address previous = address(scopeRegistry);
        scopeRegistry = IScopeRegistry(newScopeRegistry);
        emit ScopeRegistryUpdated(previous, newScopeRegistry);
    }

    // ====================== Views ======================

    function dataPoints(uint256 id) external view override returns (DataPointInfo memory) {
        DataPoint storage d = _dataPoints[id];
        return DataPointInfo({
            id: id,
            owner: d.owner,
            scopeId: d.scopeId,
            createdAt: d.createdAt,
            modifiedAt: d.modifiedAt,
            status: d.status,
            metadataVersion: d.metadataVersion
        });
    }

    function metadata(uint256 id) external view override returns (string memory) {
        DataPoint storage d = _dataPoints[id];
        if (d.status == Status.None) return "";
        return d.metadata[d.metadataVersion];
    }

    function metadataAt(uint256 id, uint256 version_) external view override returns (string memory) {
        DataPoint storage d = _dataPoints[id];
        if (d.status == Status.None) revert DataPointNotFound(id);
        if (version_ == 0 || version_ > d.metadataVersion) revert InvalidVersion(id, version_);
        return d.metadata[version_];
    }

    // ====================== Mutations ======================

    function register(bytes32 scopeId, string calldata metadata_) external override whenNotPaused returns (uint256) {
        if (bytes(metadata_).length == 0) revert EmptyMetadata();
        if (scopeRegistry.scopeStatus(scopeId) != IScopeRegistry.Status.Active) revert ScopeNotActive(scopeId);

        uint256 id = ++dataPointsCount;
        DataPoint storage d = _dataPoints[id];

        d.owner = msg.sender;
        d.scopeId = scopeId;
        d.createdAt = block.timestamp;
        d.modifiedAt = block.timestamp;
        d.status = Status.Active;
        d.metadataVersion = 1;
        d.metadata[1] = metadata_;

        emit DataPointRegistered(id, msg.sender, scopeId, metadata_);
        return id;
    }

    function updateMetadata(uint256 id, string calldata metadata_)
        external
        override
        whenNotPaused
        onlyDataPointOwner(id)
    {
        if (bytes(metadata_).length == 0) revert EmptyMetadata();

        DataPoint storage d = _dataPoints[id];
        uint256 newVersion = ++d.metadataVersion;
        d.metadata[newVersion] = metadata_;
        d.modifiedAt = block.timestamp;

        emit DataPointMetadataUpdated(id, newVersion, metadata_);
    }

    function setStatus(uint256 id, Status newStatus) external override whenNotPaused onlyDataPointOwner(id) {
        if (newStatus == Status.None) revert InvalidStatus();

        DataPoint storage d = _dataPoints[id];
        d.status = newStatus;
        d.modifiedAt = block.timestamp;

        emit DataPointStatusChanged(id, newStatus);
    }
}
