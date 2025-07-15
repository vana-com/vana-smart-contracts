// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPermissions.sol";

abstract contract DataPermissionsStorageV1 is IDataPermissions {
    address internal _trustedForwarder;

    mapping(address userAddress => User) internal _users;

    uint256 public permissionsCount;
    mapping(uint256 permissionId => Permission) internal _permissions;

    mapping(bytes32 grantHash => uint256 permissionId) internal _grantHashToPermissionId;

    uint256 public serversCount;
    mapping(uint256 serverId => Server) internal _servers;
    mapping(address serverAddress => uint256 serverId) internal _serverAddressToId;

    uint256 public applicationsCount;
    mapping(uint256 applicationId => Application) internal _applications;
    mapping(address applicationAddress => uint256 applicationId) internal _applicationAddressToId;

    IDataRegistry internal _dataRegistry;

    mapping(uint256 fileId => EnumerableSet.UintSet permissionIds) internal _filePermissions;

    mapping(uint256 applicationId => EnumerableSet.UintSet permissionIds) internal _applicationPermissions;
}
