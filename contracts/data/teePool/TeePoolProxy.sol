// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract TeePoolProxy is ERC1967Proxy {
    constructor(address logic, bytes memory data) ERC1967Proxy(logic, data) {}
}
