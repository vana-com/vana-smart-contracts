// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDATFactory.sol";

abstract contract DATFactoryStorageV1 is IDATFactory {
    mapping(DATType datType => address templateAddress) public override datTemplates;

    EnumerableSet.AddressSet internal _datList;

    uint256 public override minCapDefault;
    uint256 public override maxCapDefault;
}
