// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VanaRuntimePermissionsProxy
 * @notice Proxy contract for VanaRuntimePermissions using ERC1967
 */
contract VanaRuntimePermissionsProxy is ERC1967Proxy {
    constructor(
        address implementation,
        bytes memory _data
    ) ERC1967Proxy(implementation, _data) {}
}