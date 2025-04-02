// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRoot.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IDLPRootDeprecated} from "./IDLPRootDeprecated.sol";
import {IVanaPoolStaking} from "../../vanaPoolStaking/interfaces/IVanaPoolStaking.sol";

/**
 * @notice For future upgrades, do not change DLPRootStorageV1. Create a new
 * contract which implements DLPRootStorageV1
 */
abstract contract DLPRootStorageV1 is IDLPRoot, IDLPRootDeprecated {
    address internal _trustedForwarder;
    uint256 private eligibleDlpsLimit; // not used anymore
    uint256 private epochDlpsLimit; // moved to DLPRootEpoch
    uint256 public override minStakeAmount; // Minimum stake allowed
    uint256 private minDlpStakersPercentage; // moved to DLPRootCore
    uint256 private minDlpRegistrationStake; // moved to DLPRootCore
    uint256 private dlpEligibilityThreshold; //moved to DLPRootCore
    uint256 private dlpSubEligibilityThreshold; // moved to DLPRootCore

    // Historical values tracked using checkpoints
    Checkpoints.Trace208 internal _stakeWithdrawalDelayCheckpoints;
    Checkpoints.Trace208 internal _rewardClaimDelayCheckpoints;

    uint256 private epochRewardAmount; // moved to DLPRootEpoch
    uint256 private epochSize; // moved to DLPRootEpoch
    uint256 private daySize; // moved to DLPRootCore

    // DLP management
    uint256 private dlpsCount; // moved to DLPRootCore
    mapping(uint256 dlpId => Dlp dlp) internal _dlps; // moved to DLPRootCore
    mapping(address dlpAddress => uint256 dlpId) private dlpIds; // moved to DLPRootCore
    EnumerableSet.UintSet private _eligibleDlpsList; // moved to DLPRootCore

    // Epoch tracking
    uint256 private epochsCount; // moved to DLPRootEpoch
    mapping(uint256 epochId => Epoch epoch) private _epochs; // moved to DLPRootEpoch

    // Staker management
    EnumerableSet.AddressSet internal _stakersList;
    mapping(address stakerAddress => Staker staker) internal _stakers;

    // Stake tracking
    uint256 public override stakesCount;
    mapping(uint256 stakeId => Stake stake) internal _stakes;

    uint256 private maxDlpStakersPercentage; // moved to DLPRootCore

    mapping(string dlpName => uint256 dlpId) private dlpNameToId; // moved to DLPRootCore

    IDLPRootMetrics public override dlpRootMetrics;
    IDLPRootTreasury public override dlpRootRewardsTreasury;
    IDLPRootTreasury public override dlpRootStakesTreasury;
    IDLPRootCore public override dlpRootCore;
    IDLPRootEpoch public override dlpRootEpoch;

    uint256 public stakingLastBlockNumber;
    IVanaPoolStaking public vanaPoolStaking;
}
