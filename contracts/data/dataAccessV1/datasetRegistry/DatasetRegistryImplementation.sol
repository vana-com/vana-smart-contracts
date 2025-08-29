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
    bytes32 public constant DATA_REGISTRY_ROLE = keccak256("DATA_REGISTRY_ROLE");

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

    function initialize(address ownerAddress, address initDataRegistry) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(DATA_REGISTRY_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(DATA_REGISTRY_ROLE, initDataRegistry);
    }

    function pause() external onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function createMainDataset(
        uint256 dlpId,
        address owner
    ) external whenNotPaused onlyRole(MAINTAINER_ROLE) returns (uint256) {
        if (dlpToDataset[dlpId] != 0) {
            revert DatasetAlreadyExists(dlpId);
        }

        uint256 datasetId = ++datasetsCount;
        _datasets[datasetId].owner = owner;
        _datasets[datasetId].datasetType = DatasetType.MAIN;
        dlpToDataset[dlpId] = datasetId;

        emit MainDatasetCreated(datasetId, dlpId, owner);
        return datasetId;
    }

    function createDerivedDataset(
        address owner,
        uint256[] memory parentDatasetIds,
        address[] memory contributors,
        uint256[] memory shares
    ) external whenNotPaused onlyRole(MAINTAINER_ROLE) returns (uint256) {
        if (parentDatasetIds.length == 0) {
            revert DerivedDatasetNeedsParents();
        }
        if (contributors.length != shares.length) {
            revert ContributorsSharesMismatch();
        }

        // Validate parent datasets exist and are MAIN datasets
        // Also collect parent owners to verify they are included in contributors
        address[] memory parentOwners = new address[](parentDatasetIds.length);
        for (uint256 i = 0; i < parentDatasetIds.length; i++) {
            uint256 parentId = parentDatasetIds[i];
            if (parentId == 0 || parentId > datasetsCount) {
                revert InvalidParentDataset(parentId);
            }
            if (_datasets[parentId].datasetType != DatasetType.MAIN) {
                revert ParentMustBeMainDataset(parentId);
            }
            parentOwners[i] = _datasets[parentId].owner;
        }

        // Verify each parent dataset owner is included in contributors
        for (uint256 i = 0; i < parentOwners.length; i++) {
            bool found = false;
            for (uint256 j = 0; j < contributors.length; j++) {
                if (contributors[j] == parentOwners[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                revert ParentDatasetOwnerNotIncluded(parentOwners[i]);
            }
        }

        uint256 datasetId = ++datasetsCount;
        _datasets[datasetId].owner = owner;
        _datasets[datasetId].datasetType = DatasetType.DERIVED;

        // Add parent datasets
        for (uint256 i = 0; i < parentDatasetIds.length; i++) {
            _datasets[datasetId].parentDatasetIds.add(parentDatasetIds[i]);
        }

        // Set initial shares for contributors
        uint256 totalShares = 0;
        for (uint256 i = 0; i < contributors.length; i++) {
            _datasets[datasetId].ownerShares[contributors[i]] = shares[i];
            totalShares += shares[i];
            emit OwnerSharesUpdated(datasetId, contributors[i], shares[i]);
        }
        _datasets[datasetId].totalShares = totalShares;

        emit DerivedDatasetCreated(datasetId, owner, parentDatasetIds, contributors, shares);
        return datasetId;
    }

    function addFileToDataset(
        uint256 fileId,
        uint256 dlpId,
        address fileOwner,
        uint256 share
    ) external whenNotPaused onlyRole(DATA_REGISTRY_ROLE) {
        uint256 datasetId = dlpToDataset[dlpId];
        if (datasetId == 0) {
            revert DatasetNotFound(datasetId);
        }

        Dataset storage dataset = _datasets[datasetId];

        if (dataset.fileIds.contains(fileId)) {
            revert FileAlreadyInDataset(datasetId, fileId);
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
