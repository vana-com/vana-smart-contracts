// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IDLPRoot} from "../../root/interfaces/IDLPRoot.sol";
import {IDLPRootCore} from "../../rootCore/interfaces/IDLPRootCore.sol";

interface IDLPRootEpoch {
    struct EpochDlp {
        uint256 rewardAmount; // Rewards allocated to the DLP owner //todo: rename to ownerRewardAmount
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

    // View functions for contract state and configuration
    function version() external pure returns (uint256);
    function dlpRoot() external view returns (IDLPRoot);
    function epochDlpsLimit() external view returns (uint256);
    function epochSize() external view returns (uint256);
    function daySize() external view returns (uint256);
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
    function epochRewardAmount() external view returns (uint256);

    struct EpochDlpInfo {
        uint256 stakeAmount; // 0 if not a top DLP
        bool isTopDlp; // In top DLPs list this epoch
        uint256 rewardAmount; // 0 if not top DLP or epoch not finished todo: rename to ownerRewardAmount
        uint256 stakersPercentage; // 0 if not top DLP
        uint256 totalStakesScore; // 0 if not top DLP
        bool rewardClaimed;
        uint256 stakersRewardAmount;
    }
    function epochDlps(uint256 epochId, uint256 dlpId) external view returns (EpochDlpInfo memory);

    function epochDlpStakeAmount(uint256 epochId, uint256 dlpI) external view returns (uint256);

    // Admin functions
    function pause() external;
    function unpause() external;
    function updateEpochDlpsLimit(uint256 newEpochDlpsLimit) external;
    function updateEpochSize(uint256 newEpochSize) external;
    function updateEpochRewardAmount(uint256 newEpochRewardAmount) external;

    function updateDlpRoot(address newDlpRootAddress) external;

    struct EpochDlpsTotalStakesScore {
        uint256 epochId;
        uint256 dlpId;
        uint256 totalStakesScore;
    }
    function saveEpochDlpsTotalStakesScore(EpochDlpsTotalStakesScore[] memory stakeScore) external;
    function overrideEpochDlpsTotalStakesScore(EpochDlpsTotalStakesScore memory stakeScore) external;

    function createEpochs() external;
    function createEpochsUntilBlockNumber(uint256 blockNumber) external;
    struct EpochDlpReward {
        uint256 dlpId;
        uint256 rewardAmount; //todo: rename to ownerRewardAmount
        uint256 stakersRewardAmount;
    }
    function distributeEpochRewards(uint256 epochId, EpochDlpReward[] memory epochDlpRewards) external;
    function overrideEpoch(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount) external;
}
