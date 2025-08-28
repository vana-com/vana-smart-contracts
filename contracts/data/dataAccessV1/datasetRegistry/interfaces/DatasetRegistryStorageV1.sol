// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IDatasetRegistry.sol";

abstract contract DatasetRegistryStorageV1 is IDatasetRegistry {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public datasetsCount;
    mapping(uint256 datasetId => Dataset) internal _datasets;
    
    mapping(uint256 dlpId => uint256 datasetId) public dlpToDataset;
}