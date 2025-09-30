// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IDatasetValidator {
    function validate(uint256 fileId) external view returns (bool);
}

interface IDatasetRegistry {
    event DatasetCreated(
        uint256 indexed datasetId,
        address indexed owner
    );
    
    event FileAddedToDataset(
        uint256 indexed datasetId,
        uint256 indexed fileId,
        address indexed fileOwner
    );
    
    event OwnerSharesUpdated(
        uint256 indexed datasetId,
        address indexed owner,
        uint256 shares
    );
    
    struct Dataset {
        address owner; // Owner of the dataset
        IDatasetValidator validator; // Validator contract for files
        uint256 totalShares; // Sum of all shares in dataset
        mapping(address => uint256) ownerShares; // Aggregated shares across files for each owner
        EnumerableSet.UintSet fileIds; // IDs of files in the dataset
        EnumerableSet.UintSet parentDatasetIds; // Parent dataset IDs
    }

    struct DatasetInfo {
        address owner;
        uint256 totalShares;
        uint256 fileIdsCount;
        uint256[] parentDatasetIds;
    }

    function datasetsCount() external view returns (uint256);
    
    function datasets(uint256 datasetId) external view returns (DatasetInfo memory);
    
    function createDataset(address owner) external returns (uint256);
    
    function addFileToDataset(uint256 fileId, uint256 dlpId, address fileOwner, uint256 share) external;
    
    function ownerShares(uint256 datasetId, address owner) external view returns (uint256);
    
    function datasetFiles(uint256 datasetId, uint256 offset, uint256 limit) external view returns (uint256[] memory);
    
    function isFileInDataset(uint256 datasetId, uint256 fileId) external view returns (bool);
    
}