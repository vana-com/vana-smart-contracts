// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./IVanaRuntimePermissions.sol";

abstract contract VanaRuntimePermissionsStorageV1 is IVanaRuntimePermissions {
    IDLPRegistry public dlpRegistry;

    uint256 public permissionsCount;
    mapping(uint256 permissiondId => Permission permission) internal _permissions;
    
    mapping(uint256 dlpId => uint256 genericPermissionId) internal _dlpGenericPermissions;
    mapping(uint256 dlpId => EnumerableSet.UintSet permissionIds) internal _dlpPermissions;

    uint256 public requestsCount;
    mapping(uint256 requestId => Request request) internal _requests;
    mapping(uint256 permissionId => EnumerableSet.UintSet requestIds) internal _permissionRequests;
}