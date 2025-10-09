// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDataPortabilityServers.sol";

abstract contract DataPortabilityServersStorageV1 is IDataPortabilityServers {
    address internal _trustedForwarder;

    uint256 public override serversCount;
    mapping(uint256 serverId => Server) internal _servers;
    mapping(address serverAddress => uint256 serverId) public override serverAddressToId;

    mapping(address userAddress => User) internal _users;
}
