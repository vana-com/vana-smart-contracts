// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPortabilityPermissions.sol";

abstract contract DataPortabilityPermissionsStorage is IDataPortabilityPermissions {
    address internal _trustedForwarder;

    mapping(address userAddress => User) internal _users;

    uint256 public override permissionsCount;
    mapping(uint256 permissionId => Permission) internal _permissions;

    mapping(bytes32 grantHash => uint256 permissionId) public override grantHashToPermissionId;

    IDataRegistry public override dataRegistry;

    mapping(uint256 fileId => EnumerableSet.UintSet permissionIds) internal _filePermissions;

    IDataPortabilityServers public override dataPortabilityServers;
    IDataPortabilityGrantees public override dataPortabilityGrantees;
}
