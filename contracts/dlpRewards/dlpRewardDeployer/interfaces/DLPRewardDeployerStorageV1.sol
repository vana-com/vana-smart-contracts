// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./IDLPRewardDeployer.sol";

abstract contract DLPRewardDeployerStorageV1 is IDLPRewardDeployer {
    IDLPRegistry public override dlpRegistry;
    IVanaEpoch public override vanaEpoch;
    IDLPRewardSwap public override dlpRewardSwap;
    ITreasury public override treasury;

    uint256 public override numberOfTranches;
    uint256 public override rewardPercentage;
    uint256 public override maximumSlippagePercentage;

    mapping(uint256 epochId => EpochReward) internal _epochRewards;
}
