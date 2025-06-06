// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IDLPRootCore} from "../../rootCore/interfaces/IDLPRootCore.sol";
import {IDLPRootEpoch} from "../../rootEpoch/interfaces/IDLPRootEpoch.sol";
import {IDLPRootMetrics} from "../../rootMetrics/interfaces/IDLPRootMetrics.sol";
import {IDLPRootTreasury} from "../../rootTreasury/interfaces/IDLPRootTreasury.sol";

interface IDLPRoot {
    struct Stake {
        address stakerAddress;
        uint256 dlpId;
        uint256 amount;
        uint256 startBlock;
        uint256 endBlock; // 0 if active
        bool withdrawn;
        uint256 lastClaimedIndexEpochId; //todo: rename to lastClaimedEpochId
        mapping(uint256 epochId => uint256 claimedAmount) claimedAmounts;
        uint256 movedAmount; // Amount moved to new stake
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
    function dlpRootCore() external view returns (IDLPRootCore);
    function dlpRootEpoch() external view returns (IDLPRootEpoch);

    // Additional view functions
    function minStakeAmount() external view returns (uint256);
    function stakeWithdrawalDelay() external view returns (uint256);
    function rewardClaimDelay() external view returns (uint256);

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

    function calculateStakeClaimableAmount(uint256 stakeId) external returns (uint256);
    function calculateStakeScore(
        uint256 stakeAmount,
        uint256 stakeStartBlock,
        uint256 blockNumber
    ) external view returns (uint256);

    // Admin functions
    function pause() external;
    function unpause() external;
    function updateMinStakeAmount(uint256 newMinStakeAmount) external;
    function updateStakeWithdrawalDelay(uint256 newStakeWithdrawalDelay) external;
    function updateRewardClaimDelay(uint256 newRewardClaimDelay) external;
    function updateDlpRootMetrics(address newDlpRootMetricsAddress) external;
    function updateDlpRootCore(address newDlpRootCoreAddress) external;
    function updateDlpRootEpoch(address newDlpRootEpochAddress) external;
    function updateDlpRootRewardsTreasury(address newDlpRootRewardsTreasuryAddress) external;
    function updateDlpRootStakesTreasury(address newDlpRootStakesTreasuryAddress) external;

    // Staking and rewards
    function createStake(uint256 dlpId) external payable;
    function createStakeOnBehalf(uint256 dlpId, address stakeOwner) external payable;
    function closeStakes(uint256[] memory stakeIds) external;
    function withdrawStakes(uint256[] memory stakeIds) external;
    function migrateStake(uint256 stakeId, uint256 newDlpId, uint256 newAmount) external;
    function claimStakesReward(uint256[] memory stakeIds) external;
    function claimStakeRewardUntilEpoch(uint256 stakeId, uint256 lastEpochToClaim) external;
}
