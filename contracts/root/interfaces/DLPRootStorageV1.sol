// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRoot.sol";

/**
 * @notice For future upgrades, do not change DLPRootStorageV1. Create a new
 * contract which implements DLPRootStorageV1
 */
abstract contract DLPRootStorageV1 is IDLPRoot {
    address internal _trustedForwarder;
    uint256 public override eligibleDlpsLimit; // Must be below 500 for gas efficiency
    uint256 public override epochDlpsLimit; // Max DLPs per epoch
    uint256 public override minStakeAmount; // Minimum stake allowed
    uint256 public override minDlpStakersPercentage; // Min % of rewards to stakers (in 1e18)
    uint256 public override minDlpRegistrationStake; // Min stake for new DLP registration
    uint256 public override dlpEligibilityThreshold; // Min stake for full eligibility
    uint256 public override dlpSubEligibilityThreshold; // Min stake for sub-eligibility

    // Historical values tracked using checkpoints
    Checkpoints.Trace208 internal _stakeWithdrawalDelayCheckpoints;
    Checkpoints.Trace208 internal _rewardClaimDelayCheckpoints;

    uint256 public override epochRewardAmount; // Rewards per epoch
    uint256 public override epochSize; // Blocks per epoch
    uint256 public override daySize; // Blocks per day

    // DLP management
    uint256 public override dlpsCount;
    mapping(uint256 dlpId => Dlp dlp) internal _dlps;
    mapping(address dlpAddress => uint256 dlpId) public override dlpIds;
    EnumerableSet.UintSet internal _eligibleDlpsList;

    // Epoch tracking
    uint256 public override epochsCount;
    mapping(uint256 epochId => Epoch epoch) internal _epochs;

    // Staker management
    EnumerableSet.AddressSet internal _stakersList;
    mapping(address stakerAddress => Staker staker) internal _stakers;

    // Stake tracking
    uint256 public override stakesCount;
    mapping(uint256 stakeId => Stake stake) internal _stakes;

    uint256 public override maxDlpStakersPercentage; // Max % of rewards to stakers (in 1e18)

    mapping(string dlpName => uint256 dlpId) public override dlpNameToId;
}
