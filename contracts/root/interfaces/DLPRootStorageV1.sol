// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRoot.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IDLPRootDeprecated} from "./IDLPRootDeprecated.sol";

/**
 * @notice For future upgrades, do not change DLPRootStorageV1. Create a new
 * contract which implements DLPRootStorageV1
 */
abstract contract DLPRootStorageV1 is IDLPRoot, IDLPRootDeprecated {
    address internal _trustedForwarder;
    uint256 internal eligibleDlpsLimit; // not used anymore
    uint256 internal epochDlpsLimit; // moved to DLPRootCore
    uint256 public override minStakeAmount; // Minimum stake allowed
    uint256 internal minDlpStakersPercentage; // moved to DLPRootCore
    uint256 internal minDlpRegistrationStake; // moved to DLPRootCore
    uint256 internal dlpEligibilityThreshold; //moved to DLPRootCore
    uint256 internal dlpSubEligibilityThreshold; // moved to DLPRootCore

    // Historical values tracked using checkpoints
    Checkpoints.Trace208 internal _stakeWithdrawalDelayCheckpoints;
    Checkpoints.Trace208 internal _rewardClaimDelayCheckpoints;

    uint256 internal epochRewardAmount; // moved to DLPRootCore
    uint256 internal epochSize; // moved to DLPRootCore
    uint256 internal daySize; // moved to DLPRootCore

    // DLP management
    uint256 internal dlpsCount; // moved to DLPRootCore
    mapping(uint256 dlpId => Dlp dlp) internal _dlps; // moved to DLPRootCore
    mapping(address dlpAddress => uint256 dlpId) internal dlpIds; // moved to DLPRootCore
    EnumerableSet.UintSet internal _eligibleDlpsList; // moved to DLPRootCore

    // Epoch tracking
    uint256 internal epochsCount; // moved to DLPRootCore
    mapping(uint256 epochId => Epoch epoch) internal _epochs; // moved to DLPRootCore

    // Staker management
    EnumerableSet.AddressSet internal _stakersList;
    mapping(address stakerAddress => Staker staker) internal _stakers;

    // Stake tracking
    uint256 public override stakesCount;
    mapping(uint256 stakeId => Stake stake) internal _stakes;

    uint256 internal maxDlpStakersPercentage; // moved to DLPRootCore

    mapping(string dlpName => uint256 dlpId) internal dlpNameToId; // moved to DLPRootCore

    IDLPRootMetrics public override dlpRootMetrics;
    IDLPRootTreasury public override dlpRootRewardsTreasury;
    IDLPRootTreasury public override dlpRootStakesTreasury;
    IDLPRootCore public override dlpRootCore;
    IDLPRootEpoch public override dlpRootEpoch;
}
