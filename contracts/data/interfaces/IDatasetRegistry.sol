// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDatasetRegistry {
    struct DatasetInfo {
        uint256 id;
        string name;
        string description;
        string metadata;
        address ownerAddress;
        uint256 createdAt;
    }

    function datasets(uint256 datasetId) external view returns (DatasetInfo memory);
}