// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IDatasetRegistry.sol";

/**
 * @title DatasetRegistryImplementation
 * @notice Implementation of the DatasetRegistry contract
 * @dev Manages datasets as logical groupings of files with cryptographic identity
 */
contract DatasetRegistryImplementation is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    IDatasetRegistry
{
    /// @notice Role for dataset management operations
    bytes32 public constant DATASET_MANAGER_ROLE =
        keccak256("DATASET_MANAGER_ROLE");

    /// @notice Role for file operations
    bytes32 public constant FILE_MANAGER_ROLE = keccak256("FILE_MANAGER_ROLE");

    /// @notice Counter for dataset IDs
    uint256 private _datasetIdCounter;

    /// @notice Mapping from dataset ID to Dataset struct
    mapping(uint256 => Dataset) private _datasets;

    /// @notice Mapping from dataset ID to set of file IDs
    mapping(uint256 => mapping(uint256 => bool)) private _datasetFiles;

    /// @notice Mapping from dataset ID to set of pending file IDs
    mapping(uint256 => mapping(uint256 => bool)) private _pendingFiles;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to be granted admin role
     */
    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DATASET_MANAGER_ROLE, admin);
        _grantRole(FILE_MANAGER_ROLE, admin);

        _datasetIdCounter = 1; // Start from 1
    }

    /**
     * @notice Create a new dataset
     * @param owner Address that will own the dataset
     * @param schemaId Schema identifier for the dataset structure
     * @return datasetId The unique identifier for the created dataset
     */
    function createDataset(
        address owner,
        uint256 schemaId
    ) external override onlyRole(DATASET_MANAGER_ROLE) returns (uint256) {
        require(owner != address(0), "Invalid owner address");

        uint256 datasetId = _datasetIdCounter++;

        Dataset storage dataset = _datasets[datasetId];
        dataset.owner = owner;
        dataset.schemaId = schemaId;
        dataset.createdAt = block.timestamp;

        emit DatasetCreated(datasetId, owner, schemaId);

        return datasetId;
    }

    /**
     * @notice Add a file to a dataset's pending list
     * @param datasetId The dataset to add the file to
     * @param fileId The file identifier to add
     */
    function addPendingFile(
        uint256 datasetId,
        uint256 fileId
    ) external override onlyRole(FILE_MANAGER_ROLE) nonReentrant {
        require(_datasets[datasetId].owner != address(0), "Dataset not found");
        require(!_datasetFiles[datasetId][fileId], "File already in dataset");
        require(!_pendingFiles[datasetId][fileId], "File already pending");

        _pendingFiles[datasetId][fileId] = true;
        _datasets[datasetId].pendingFileIds.push(fileId);

        emit FileAddedToDataset(datasetId, fileId, true);
    }

    /**
     * @notice Accept a pending file into the dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier to accept
     */
    function acceptFile(
        uint256 datasetId,
        uint256 fileId
    ) external override nonReentrant {
        Dataset storage dataset = _datasets[datasetId];
        require(dataset.owner != address(0), "Dataset not found");
        require(
            msg.sender == dataset.owner ||
                hasRole(FILE_MANAGER_ROLE, msg.sender),
            "Not authorized"
        );
        require(_pendingFiles[datasetId][fileId], "File not pending");

        // Remove from pending
        _pendingFiles[datasetId][fileId] = false;
        _removePendingFileFromArray(datasetId, fileId);

        // Add to accepted files
        _datasetFiles[datasetId][fileId] = true;
        dataset.fileIds.push(fileId);

        emit FileAccepted(datasetId, fileId);
    }

    /**
     * @notice Reject a pending file from the dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier to reject
     */
    function rejectFile(
        uint256 datasetId,
        uint256 fileId
    ) external override nonReentrant {
        Dataset storage dataset = _datasets[datasetId];
        require(dataset.owner != address(0), "Dataset not found");
        require(
            msg.sender == dataset.owner ||
                hasRole(FILE_MANAGER_ROLE, msg.sender),
            "Not authorized"
        );
        require(_pendingFiles[datasetId][fileId], "File not pending");

        // Remove from pending
        _pendingFiles[datasetId][fileId] = false;
        _removePendingFileFromArray(datasetId, fileId);

        emit FileRejected(datasetId, fileId);
    }

    /**
     * @notice Transfer ownership of a dataset
     * @param datasetId The dataset identifier
     * @param newOwner The new owner address
     */
    function transferDatasetOwnership(
        uint256 datasetId,
        address newOwner
    ) external override {
        require(newOwner != address(0), "Invalid new owner");
        Dataset storage dataset = _datasets[datasetId];
        require(dataset.owner != address(0), "Dataset not found");
        require(msg.sender == dataset.owner, "Not owner");

        address previousOwner = dataset.owner;
        dataset.owner = newOwner;

        emit DatasetOwnershipTransferred(datasetId, previousOwner, newOwner);
    }

    /**
     * @notice Get dataset information
     * @param datasetId The dataset identifier
     * @return dataset The dataset structure
     */
    function getDataset(
        uint256 datasetId
    ) external view override returns (Dataset memory dataset) {
        require(_datasets[datasetId].owner != address(0), "Dataset not found");
        return _datasets[datasetId];
    }

    /**
     * @notice Get all file IDs in a dataset
     * @param datasetId The dataset identifier
     * @return fileIds Array of file identifiers
     */
    function getDatasetFiles(
        uint256 datasetId
    ) external view override returns (uint256[] memory fileIds) {
        require(_datasets[datasetId].owner != address(0), "Dataset not found");
        return _datasets[datasetId].fileIds;
    }

    /**
     * @notice Get all pending file IDs in a dataset
     * @param datasetId The dataset identifier
     * @return pendingFileIds Array of pending file identifiers
     */
    function getPendingFiles(
        uint256 datasetId
    ) external view override returns (uint256[] memory pendingFileIds) {
        require(_datasets[datasetId].owner != address(0), "Dataset not found");
        return _datasets[datasetId].pendingFileIds;
    }

    /**
     * @notice Check if a file is in a dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier
     * @return exists True if the file exists in the dataset
     */
    function fileExistsInDataset(
        uint256 datasetId,
        uint256 fileId
    ) external view override returns (bool exists) {
        return _datasetFiles[datasetId][fileId];
    }

    /**
     * @dev Internal function to remove a file from pending array
     */
    function _removePendingFileFromArray(
        uint256 datasetId,
        uint256 fileId
    ) private {
        uint256[] storage pending = _datasets[datasetId].pendingFileIds;
        for (uint256 i = 0; i < pending.length; i++) {
            if (pending[i] == fileId) {
                pending[i] = pending[pending.length - 1];
                pending.pop();
                break;
            }
        }
    }

    /**
     * @dev Required override for UUPS upgrades
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[50] private __gap;
}
