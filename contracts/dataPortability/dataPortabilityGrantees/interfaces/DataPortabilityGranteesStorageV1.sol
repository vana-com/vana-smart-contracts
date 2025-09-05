// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPortabilityGrantees.sol";

abstract contract DataPortabilityGranteesStorageV1 is IDataPortabilityGrantees {
    address internal _trustedForwarder;

    uint256 public override granteesCount;
    mapping(uint256 granteeId => Grantee) internal _grantees;
    mapping(address granteeAddress => uint256 granteeId) public override granteeAddressToId;

    mapping(uint256 granteeId => EnumerableSet.UintSet permissionIds) internal _granteePermissions;
}