// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IDatasetRegistry
 * @notice Interface for the DatasetRegistry contract
 * @dev Manages datasets as logical groupings of files with cryptographic identity
 */
interface IDatasetRegistry {
    /**
     * @notice Structure representing a dataset
     * @param owner Address that owns this dataset
     * @param pendingFileIds Set of file IDs awaiting verification (e.g., 'contribute')
     * @param fileIds Set of file IDs that have been accepted into the dataset
     * @param schemaId Identifier for the dataset schema
     * @param createdAt Timestamp when dataset was created
     */
    struct Dataset {
        address owner;
        uint256[] pendingFileIds;
        uint256[] fileIds;
        uint256 schemaId;
        uint256 createdAt;
    }

    /**
     * @notice Emitted when a new dataset is created
     * @param datasetId The unique identifier for the dataset
     * @param owner Address of the dataset owner
     * @param schemaId Schema identifier for the dataset
     */
    event DatasetCreated(
        uint256 indexed datasetId,
        address indexed owner,
        uint256 schemaId
    );

    /**
     * @notice Emitted when a file is added to a dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier that was added
     * @param isPending Whether the file is pending verification
     */
    event FileAddedToDataset(
        uint256 indexed datasetId,
        uint256 indexed fileId,
        bool isPending
    );

    /**
     * @notice Emitted when a pending file is accepted into a dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier that was accepted
     */
    event FileAccepted(uint256 indexed datasetId, uint256 indexed fileId);

    /**
     * @notice Emitted when a pending file is rejected from a dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier that was rejected
     */
    event FileRejected(uint256 indexed datasetId, uint256 indexed fileId);

    /**
     * @notice Emitted when dataset ownership is transferred
     * @param datasetId The dataset identifier
     * @param previousOwner Previous owner address
     * @param newOwner New owner address
     */
    event DatasetOwnershipTransferred(
        uint256 indexed datasetId,
        address indexed previousOwner,
        address indexed newOwner
    );

    /**
     * @notice Create a new dataset
     * @param owner Address that will own the dataset
     * @param schemaId Schema identifier for the dataset structure
     * @return datasetId The unique identifier for the created dataset
     */
    function createDataset(
        address owner,
        uint256 schemaId
    ) external returns (uint256 datasetId);

    /**
     * @notice Add a file to a dataset's pending list
     * @param datasetId The dataset to add the file to
     * @param fileId The file identifier to add
     */
    function addPendingFile(uint256 datasetId, uint256 fileId) external;

    /**
     * @notice Accept a pending file into the dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier to accept
     */
    function acceptFile(uint256 datasetId, uint256 fileId) external;

    /**
     * @notice Reject a pending file from the dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier to reject
     */
    function rejectFile(uint256 datasetId, uint256 fileId) external;

    /**
     * @notice Transfer ownership of a dataset
     * @param datasetId The dataset identifier
     * @param newOwner The new owner address
     */
    function transferDatasetOwnership(
        uint256 datasetId,
        address newOwner
    ) external;

    /**
     * @notice Get dataset information
     * @param datasetId The dataset identifier
     * @return dataset The dataset structure
     */
    function getDataset(
        uint256 datasetId
    ) external view returns (Dataset memory dataset);

    /**
     * @notice Get all file IDs in a dataset
     * @param datasetId The dataset identifier
     * @return fileIds Array of file identifiers
     */
    function getDatasetFiles(
        uint256 datasetId
    ) external view returns (uint256[] memory fileIds);

    /**
     * @notice Get all pending file IDs in a dataset
     * @param datasetId The dataset identifier
     * @return pendingFileIds Array of pending file identifiers
     */
    function getPendingFiles(
        uint256 datasetId
    ) external view returns (uint256[] memory pendingFileIds);

    /**
     * @notice Check if a file is in a dataset
     * @param datasetId The dataset identifier
     * @param fileId The file identifier
     * @return exists True if the file exists in the dataset
     */
    function fileExistsInDataset(
        uint256 datasetId,
        uint256 fileId
    ) external view returns (bool exists);
}
