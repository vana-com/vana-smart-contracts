// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRootMetrics.sol";

/**
 * @title Storage for DLPRootMetrics
 * @notice For future upgrades, do not change DLPRootMetricsStorageV1. Create a new
 * contract which implements DLPRootMetricsStorageV1
 */
abstract contract DLPRootMetricsStorageV1 is IDLPRootMetrics {
    address private _trustedForwarder; // not used anymore
    IDLPRoot public override dlpRoot;

    mapping(uint256 epochId => Epoch) internal _epochs;

    mapping(RatingType ratingType => uint256 percentage) public override ratingPercentages;

    address payable internal _foundationWalletAddress;
}
