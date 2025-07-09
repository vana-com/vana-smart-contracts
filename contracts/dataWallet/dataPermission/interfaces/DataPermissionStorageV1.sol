// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPermission.sol";

abstract contract DataPermissionStorageV1 is IDataPermission {
    address internal _trustedForwarder;

    mapping(address userAddress => User) internal _users;

    uint256 public permissionsCount;
    mapping(uint256 permissionId => Permission) internal _permissions;

    mapping(bytes32 grantHash => uint256 permissionId) internal _grantHashToPermissionId;

    mapping(address serverId => Server server) internal _servers;
}
