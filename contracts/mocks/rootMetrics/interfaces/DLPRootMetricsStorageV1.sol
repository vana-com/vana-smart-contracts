// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRootMetrics.sol";

/**
 * @title Storage for DLPRootMetrics
 * @notice For future upgrades, do not change DLPRootMetricsStorageV1. Create a new
 * contract which implements DLPRootMetricsStorageV1
 */
abstract contract DLPRootMetricsStorageV1 is IDLPRootMetrics {
    address internal _trustedForwarder;
    uint256 public override filesCount;
    mapping(uint256 fileId => File) internal _files;
}
