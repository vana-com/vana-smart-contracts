// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IDatasetRegistry.sol";
import "../../../dataRegistry/interfaces/IDataRegistry.sol";
import "../../../interfaces/IDLPRegistry.sol";

abstract contract DatasetRegistryStorageV1 is IDatasetRegistry {
    IDataRegistry public dataRegistry;
    IDLPRegistry public dlpRegistry;

    uint256 public datasetsCount;
    mapping(uint256 datasetId => Dataset) internal _datasets;

}