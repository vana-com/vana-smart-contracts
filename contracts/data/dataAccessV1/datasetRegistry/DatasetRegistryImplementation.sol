// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./interfaces/DatasetRegistryStorageV1.sol";

contract DatasetRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DatasetRegistryStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    error DatasetNotFound(uint256 datasetId);
    error DatasetAlreadyExists(uint256 dlpId);
    error OnlyDatasetOwner();
    error FileAlreadyInDataset(uint256 datasetId, uint256 fileId);
    error DerivedDatasetNeedsParents();
    error InvalidParentDataset(uint256 parentDatasetId);
    error ParentMustBeMainDataset(uint256 parentDatasetId);
    error ContributorsSharesMismatch();
    error ParentDatasetOwnerNotIncluded(address parentOwner);
    error InvalidSharesSum();
    error FileValidationFailed(uint256 fileId);

    modifier onlyDatasetOwner(uint256 datasetId) {
        if (_datasets[datasetId].owner != msg.sender) {
            revert OnlyDatasetOwner();
        }
        _;
    }

    modifier datasetExists(uint256 datasetId) {
        if (datasetId == 0 || datasetId > datasetsCount) {
            revert DatasetNotFound(datasetId);
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, IDataRegistry initDataRegistry) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();

        dataRegistry = initDataRegistry;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    function pause() external onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function createDataset(
        address owner,
        IDatasetValidator validator
    ) external whenNotPaused returns (uint256) {
        uint256 datasetId = ++datasetsCount;
        _datasets[datasetId].owner = owner;
        _datasets[datasetId].validator = validator;
        
        emit DatasetCreated(datasetId, owner);
        return datasetId;
    }

    function addFileToDataset(
        uint256 datasetId,
        uint256 fileId
    ) external whenNotPaused {
        Dataset storage dataset = _datasets[datasetId];

        if (dataset.fileIds.contains(fileId)) {
            revert FileAlreadyInDataset(datasetId, fileId);
        }

        address fileOwner = dataRegistry.files(fileId).ownerAddress;
        if (msg.sender != fileOwner) {
            revert OnlyDatasetOwner();
        }

        if (!dataset.validator.validate(fileId)) {
            revert FileValidationFailed(fileId);
        }

        dataset.fileIds.add(fileId);
        dataset.ownerShares[fileOwner] += share;
        dataset.totalShares += share;

        emit FileAddedToDataset(datasetId, fileId, fileOwner);
        emit OwnerSharesUpdated(datasetId, fileOwner, dataset.ownerShares[fileOwner]);
    }

    function datasets(uint256 datasetId) external view datasetExists(datasetId) returns (DatasetInfo memory) {
        Dataset storage dataset = _datasets[datasetId];
        return
            DatasetInfo({
                owner: dataset.owner,
                datasetType: dataset.datasetType,
                totalShares: dataset.totalShares,
                fileIdsCount: dataset.fileIds.length(),
                parentDatasetIds: dataset.parentDatasetIds.values()
            });
    }

    function ownerShares(uint256 datasetId, address owner) external view datasetExists(datasetId) returns (uint256) {
        return _datasets[datasetId].ownerShares[owner];
    }

    function datasetFiles(
        uint256 datasetId,
        uint256 offset,
        uint256 limit
    ) external view datasetExists(datasetId) returns (uint256[] memory) {
        EnumerableSet.UintSet storage fileIds = _datasets[datasetId].fileIds;
        uint256 totalFiles = fileIds.length();

        if (offset >= totalFiles) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > totalFiles) {
            end = totalFiles;
        }

        uint256[] memory result = new uint256[](end - offset);
        for (uint256 i = 0; i < end - offset; i++) {
            result[i] = fileIds.at(offset + i);
        }

        return result;
    }

    function isFileInDataset(uint256 datasetId, uint256 fileId) external view datasetExists(datasetId) returns (bool) {
        return _datasets[datasetId].fileIds.contains(fileId);
    }
}
