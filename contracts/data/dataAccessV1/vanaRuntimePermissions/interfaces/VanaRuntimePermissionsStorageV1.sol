// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./IVanaRuntimePermissions.sol";

abstract contract VanaRuntimePermissionsStorageV1 is IVanaRuntimePermissions {
    IDatasetRegistry public datasetRegistry;

    uint256 public permissionsCount;
    mapping(uint256 permissiondId => Permission permission) internal _permissions;
    
    mapping(uint256 datasetId => uint256 genericPermissionId) internal _datasetGenericPermissions;
    mapping(uint256 datasetId => EnumerableSet.UintSet permissionIds) internal _datasetPermissions;

    uint256 public requestsCount;
    mapping(uint256 requestId => Request request) internal _requests;
    mapping(uint256 permissionId => EnumerableSet.UintSet requestIds) internal _permissionRequests;

    mapping(address vanaRuntime => uint256 requestId) internal _vanaRuntimeToRequest;
    mapping(address vanaRuntime => address grantor) internal _vanaRuntimeToGrantor;
}