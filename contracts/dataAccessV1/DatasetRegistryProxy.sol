// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DatasetRegistryProxy
 * @notice Proxy contract for DatasetRegistry
 * @dev This is a standard ERC1967 proxy that delegates all calls to the implementation contract
 */
contract DatasetRegistryProxy is ERC1967Proxy {
    /**
     * @notice Initialize the proxy with implementation address and initialization data
     * @param _logic Address of the initial implementation contract
     * @param _data Initialization data to be passed to the implementation
     */
    constructor(
        address _logic,
        bytes memory _data
    ) ERC1967Proxy(_logic, _data) {}
}
