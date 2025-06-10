// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRootTreasury.sol";

/**
 * @title Storage for DLPRootTreasury
 * @notice For future upgrades, do not change DLPRootTreasuryStorageV1. Create a new
 * contract which implements DLPRootTreasuryStorageV1
 */
abstract contract DLPRootTreasuryStorageV1 is IDLPRootTreasury {
    address internal _trustedForwarder;
    uint256 public override filesCount;
    mapping(uint256 fileId => File) internal _files;
}
