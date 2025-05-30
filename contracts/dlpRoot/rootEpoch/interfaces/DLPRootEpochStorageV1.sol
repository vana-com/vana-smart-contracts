// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRootEpoch.sol";

abstract contract DLPRootEpochStorageV1 is IDLPRootEpoch {
    IDLPRoot public override dlpRoot;

    uint256 public override epochDlpsLimit; // Max DLPs per epoch

    uint256 public override epochRewardAmount; // Rewards per epoch
    uint256 public override epochSize; // Blocks per epoch
    uint256 public override daySize; // Blocks per day

    // Epoch tracking
    uint256 public override epochsCount;
    mapping(uint256 epochId => Epoch epoch) internal _epochs;
}
