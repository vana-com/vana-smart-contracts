// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IDatasetRegistry {
    struct OwnerShare {
        address owner;
        uint256 share;
    }

    enum DatasetType {
        MAIN,
        DERIVED
    }

    event MainDatasetCreated(
        uint256 indexed datasetId,
        uint256 indexed dlpId,
        address indexed owner
    );
    
    event DerivedDatasetCreated(
        uint256 indexed datasetId,
        address indexed owner,
        uint256[] parentDatasetIds,
        address[] contributors,
        uint256[] shares
    );
    
    event FileAddedToDataset(
        uint256 indexed datasetId,
        uint256 indexed fileId
    );
    
    event OwnerSharesUpdated(
        uint256 indexed datasetId,
        address indexed owner,
        uint256 shares
    );

    struct Dataset {
        address owner; // Owner of the dataset
        DatasetType datasetType; // Type of dataset (MAIN or DERIVED)
        uint256 totalShares; // Sum of all shares in dataset
        mapping(address => uint256) ownerShares; // Aggregated shares across files for each owner
        EnumerableSet.UintSet fileIds; // IDs of files in the dataset
        EnumerableSet.UintSet parentDatasetIds; // Parent dataset IDs (only for DERIVED datasets)
        string fileIdsUrl; // IPFS URL containing list of file IDs for derived datasets
    }

    struct DatasetInfo {
        address owner;
        DatasetType datasetType;
        uint256 totalShares;
        uint256 fileIdsCount;
        uint256[] parentDatasetIds;
        string fileIdsUrl;
    }

    function datasetsCount() external view returns (uint256);
    
    function dlpToDataset(uint256 dlpId) external view returns (uint256);
    
    function datasets(uint256 datasetId) external view returns (DatasetInfo memory);
    
    function createMainDataset(uint256 dlpId, address owner) external returns (uint256);
    
    function createDerivedDataset(
        address owner,
        uint256[] memory parentDatasetIds,
        address[] memory contributors,
        uint256[] memory shares,
        string memory fileIdsUrl
    ) external returns (uint256);
    
    function addFileToMainDataset(uint256 fileId, uint256 dlpId, OwnerShare[] memory shares) external;
    
    function addFileToDerivedDataset(uint256 fileId, uint256 datasetId) external;
    
    function ownerShares(uint256 datasetId, address owner) external view returns (uint256);
    
    function datasetFiles(uint256 datasetId, uint256 offset, uint256 limit) external view returns (uint256[] memory);
    
    function isFileInDataset(uint256 datasetId, uint256 fileId) external view returns (bool);
    
}