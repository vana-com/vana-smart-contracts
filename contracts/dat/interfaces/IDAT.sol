// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDAT {
    function initialize(
        string memory name,
        string memory symbol,
        address owner,
        uint256 cap,
        address[] memory receivers,
        uint256[] memory amounts
    ) external;
}
