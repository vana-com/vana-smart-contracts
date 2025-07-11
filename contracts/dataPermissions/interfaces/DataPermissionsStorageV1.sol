// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPermissions.sol";

abstract contract DataPermissionsStorageV1 is IDataPermissions {
    address internal _trustedForwarder;

    mapping(address userAddress => User) internal _users;

    uint256 public permissionsCount;
    mapping(uint256 permissionId => Permission) internal _permissions;

    mapping(bytes32 grantHash => uint256 permissionId) internal _grantHashToPermissionId;

    mapping(address serverId => Server server) internal _servers;
    
    IDataRegistry internal _dataRegistry;

    // File tracking
    mapping(uint256 fileId => EnumerableSet.UintSet permissionIds) internal _filePermissions;
}
