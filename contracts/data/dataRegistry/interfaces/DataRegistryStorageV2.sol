// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataRegistryStorageV1.sol";
import "../../dataAccessV1/datasetRegistry/interfaces/IDatasetRegistry.sol";

/**
 * @title Storage V2 for DataRegistry
 * @notice Extends DataRegistryStorageV1 with DatasetRegistry integration
 * @notice For future upgrades, do not change DataRegistryStorageV2. Create a new
 * contract which implements DataRegistryStorageV2
 */
abstract contract DataRegistryStorageV2 is DataRegistryStorageV1 {
    IDatasetRegistry public datasetRegistry;
}