// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IDatasetRegistry.sol";
import "../../../dataRegistry/interfaces/IDataRegistry.sol";

abstract contract DatasetRegistryStorageV1 is IDatasetRegistry {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    IDataRegistry public dataRegistry;

    uint256 public datasetsCount;
    mapping(uint256 datasetId => Dataset) internal _datasets;

}