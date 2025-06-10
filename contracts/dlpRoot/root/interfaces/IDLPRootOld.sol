// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IDLPRootMetrics} from "../../rootMetrics/interfaces/IDLPRootMetrics.sol";
import {IDLPRootTreasury} from "../../rootTreasury/interfaces/IDLPRootTreasury.sol";

interface IDLPRootOld {
    // DLP lifecycle states from registration to deregistration
    enum DlpStatus {
        None,
        Registered,
        Eligible, // Can participate in epochs
        SubEligible, // Below threshold but above minimum
        Deregistered
    }

    struct Dlp {
        uint256 id;
        address dlpAddress;
        address ownerAddress;
        address payable treasuryAddress; // Receives non-staker rewards
        Checkpoints.Trace208 stakersPercentageCheckpoints; // Historical staker percentages
        string name;
        string iconUrl;
        string website;
        string metadata;
        DlpStatus status;
        uint256 registrationBlockNumber;
        Checkpoints.Trace208 stakeAmountCheckpoints; // Historical stake amounts
        Checkpoints.Trace208 unstakeAmountCheckpoints; // Historical unstake amounts
        uint256 epochIdsCount; // Number of participated epochs
        mapping(uint256 index => uint256 epochIds) epochIds;
        bool isVerified;
    }

    struct EpochDlp {
        uint256 rewardAmount; // Rewards allocated to the DLP owner
        uint256 stakersRewardAmount; //Rewards allocated to the stakers of the DLP
        uint256 totalStakesScore; // Sum of weighted stake scores
        bool rewardClaimed; // True if reward has been claimed
    }

    struct Epoch {
        uint256 startBlock;
        uint256 endBlock;
        uint256 rewardAmount;
        bool isFinalised;
        EnumerableSet.UintSet dlpIds; // Participating DLPs
        mapping(uint256 dlpId => EpochDlp epochDlp) dlps;
    }

    struct Stake {
        address stakerAddress;
        uint256 dlpId;
        uint256 amount;
        uint256 startBlock;
        uint256 endBlock; // 0 if active
        bool withdrawn;
        uint256 lastClaimedIndexEpochId;
        mapping(uint256 epochId => uint256 claimedAmount) claimedAmounts;
    }

    struct Staker {
        EnumerableSet.UintSet dlpIds; // DLPs staked on by this staker
        mapping(uint256 dlpId => uint256 dlpStakeAmount) dlpStakeAmounts;
        EnumerableSet.UintSet stakeIds; // Stakes made by this staker
        uint256 totalStakeAmount;
    }

    // View functions for contract state and configuration
    function version() external pure returns (uint256);
    function dlpRootMetrics() external view returns (IDLPRootMetrics);
    function dlpRootRewardsTreasury() external view returns (IDLPRootTreasury);
    function dlpRootStakesTreasury() external view returns (IDLPRootTreasury);
    function epochDlpsLimit() external view returns (uint256);
    function eligibleDlps() external view returns (uint256);
    function epochSize() external view returns (uint256);
    function daySize() external view returns (uint256);
    function eligibleDlpsListValues() external view returns (uint256[] memory);
    function eligibleDlpsListCount() external view returns (uint256);
    function eligibleDlpsListAt(uint256 index) external view returns (uint256);
    function epochsCount() external view returns (uint256);

    // Read-only struct views
    struct EpochInfo {
        uint256 startBlock;
        uint256 endBlock;
        uint256 rewardAmount;
        bool isFinalised;
        uint256[] dlpIds;
    }
    function epochs(uint256 epochId) external view returns (EpochInfo memory);

    // Additional view functions
    function minStakeAmount() external view returns (uint256);
    function minDlpStakersPercentage() external view returns (uint256);
    function maxDlpStakersPercentage() external view returns (uint256);
    function minDlpRegistrationStake() external view returns (uint256);
    function dlpEligibilityThreshold() external view returns (uint256);
    function dlpSubEligibilityThreshold() external view returns (uint256);
    function eligibleDlpsLimit() external view returns (uint256);
    function stakeWithdrawalDelay() external view returns (uint256);
    function rewardClaimDelay() external view returns (uint256);
    function epochRewardAmount() external view returns (uint256);
    function dlpsCount() external view returns (uint256);

    struct DlpInfo {
        uint256 id;
        address dlpAddress;
        address ownerAddress;
        address treasuryAddress;
        uint256 stakersPercentage;
        uint256 stakersPercentageEpoch;
        string name;
        string iconUrl;
        string website;
        string metadata;
        DlpStatus status;
        uint256 registrationBlockNumber;
        uint256 stakeAmount;
        uint256[] epochIds;
        bool isVerified;
    }
    function dlps(uint256 dlpId) external view returns (DlpInfo memory);
    function dlpsByAddress(address dlpAddress) external view returns (DlpInfo memory);
    function dlpIds(address dlpAddress) external view returns (uint256);
    function dlpNameToId(string calldata dlpName) external view returns (uint256);
    function dlpsByName(string calldata dlpName) external view returns (DlpInfo memory);

    struct DlpEpochInfo {
        uint256 stakeAmount; // 0 if not a top DLP
        bool isTopDlp; // In top DLPs list this epoch
        uint256 rewardAmount; // 0 if not top DLP or epoch not finished
        uint256 stakersPercentage; // 0 if not top DLP
        uint256 totalStakesScore; // 0 if not top DLP
        bool rewardClaimed;
        uint256 stakersRewardAmount;
    }
    function dlpEpochs(uint256 dlpId, uint256 epochId) external view returns (DlpEpochInfo memory);
    function stakersListCount() external view returns (uint256);
    function stakersListAt(uint256 index) external view returns (address);
    function stakerDlpsListCount(address stakerAddress) external view returns (uint256);
    function stakerDlpsListAt(address stakerAddress, uint256 index) external view returns (uint256);
    function stakerDlpsListValues(address stakerAddress) external view returns (uint256[] memory);
    function stakerStakesListCount(address stakerAddress) external view returns (uint256);
    function stakerStakesListAt(address stakerAddress, uint256 index) external view returns (uint256);
    function stakerStakesListValues(address stakerAddress) external view returns (uint256[] memory);
    function stakerTotalStakeAmount(address stakerAddress) external view returns (uint256);
    function stakerDlpStakeAmount(address stakerAddress, uint256 dlpId) external view returns (uint256);
    function stakesCount() external view returns (uint256);

    struct StakeInfo {
        uint256 id;
        address stakerAddress;
        uint256 dlpId;
        uint256 amount;
        uint256 startBlock;
        uint256 endBlock;
        bool withdrawn;
        uint256 lastClaimedEpochId;
    }
    function stakes(uint256 stakeId) external view returns (StakeInfo memory);
    function stakeClaimedAmounts(uint256 stakeId, uint256 epochId) external view returns (uint256);
    function dlpEpochStakeAmount(uint256 dlpId, uint256 epochId) external view returns (uint256);

    // Core functionality
    function topDlpIds(uint256 numberOfDlps) external returns (uint256[] memory);
    function calculateStakeClaimableAmount(uint256 stakeId) external returns (uint256);
    function calculateStakeScore(
        uint256 stakeAmount,
        uint256 stakeStartBlock,
        uint256 blockNumber
    ) external view returns (uint256);

    struct DlpRewardApy {
        uint256 dlpId;
        uint256 APY; //annual percentage yield for stakers
        uint256 EPY; //epoch percentage yield for stakers
    }

    function estimatedDlpRewardPercentages(uint256[] memory dlpIds) external view returns (DlpRewardApy[] memory);

    // Admin functions
    function pause() external;
    function unpause() external;
    function updateEpochDlpsLimit(uint256 newEpochDlpsLimit) external;
    function updateEpochSize(uint256 newEpochSize) external;
    function updateEpochRewardAmount(uint256 newEpochRewardAmount) external;
    function updateMinStakeAmount(uint256 newMinStakeAmount) external;
    function updateDlpStakersPercentages(
        uint256 newMinDlpStakersPercentage,
        uint256 newMaxDlpStakersPercentage
    ) external;
    function updateMinDlpRegistrationStake(uint256 newMinStakeAmount) external;
    function updateDlpEligibilityThresholds(
        uint256 newDlpSubEligibilityThreshold,
        uint256 newDlpEligibilityThreshold
    ) external;
    function updateStakeWithdrawalDelay(uint256 newStakeWithdrawalDelay) external;
    function updateRewardClaimDelay(uint256 newRewardClaimDelay) external;
    function updateDlpRootMetrics(address newDlpRootMetricsAddress) external;
    function updateDlpRootRewardsTreasury(address newDlpRootRewardsTreasuryAddress) external;
    function updateDlpRootStakesTreasury(address newDlpRootStakesTreasuryAddress) external;

    struct EpochDlpsTotalStakesScore {
        uint256 epochId;
        uint256 dlpId;
        uint256 totalStakesScore;
    }
    function saveEpochDlpsTotalStakesScore(EpochDlpsTotalStakesScore[] memory stakeScore) external;
    function overrideEpochDlpsTotalStakesScore(EpochDlpsTotalStakesScore memory stakeScore) external;

    // Epoch management
    function createEpochs() external;
    function createEpochsUntilBlockNumber(uint256 blockNumber) external;
    struct EpochDlpReward {
        uint256 dlpId;
        uint256 rewardAmount;
        uint256 stakersRewardAmount;
    }
    function distributeEpochRewards(uint256 epochId, EpochDlpReward[] memory epochDlpRewards) external;
    function overrideEpoch(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount) external;

    struct DlpRegistration {
        address dlpAddress;
        address ownerAddress;
        address payable treasuryAddress;
        uint256 stakersPercentage;
        string name;
        string iconUrl;
        string website;
        string metadata;
    }

    // DLP lifecycle management
    function registerDlp(DlpRegistration calldata registrationInfo) external payable;
    function updateDlpVerification(uint256 dlpId, bool isVerified) external;
    function updateDlp(uint256 dlpId, DlpRegistration calldata dlpUpdateInfo) external;
    function deregisterDlp(uint256 dlpId) external;

    // Staking and rewards
    function claimStakeRewardUntilEpoch(uint256 stakeId, uint256 lastEpochToClaim) external;
    function claimStakesReward(uint256[] memory stakeIds) external;
    function createStake(uint256 dlpId) external payable;
    function closeStakes(uint256[] memory stakeIds) external;
    function withdrawStakes(uint256[] memory stakeIds) external;
}
