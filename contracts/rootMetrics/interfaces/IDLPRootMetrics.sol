// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDLPRoot} from "../../root/interfaces/IDLPRoot.sol";
import {IDLPRootCore} from "../../rootCore/interfaces/IDLPRootCore.sol";
import {IDLPRootEpoch} from "../../rootEpoch/interfaces/IDLPRootEpoch.sol";

interface IDLPRootMetrics {
    enum RatingType {
        Stake,
        Performance
    }
    struct EpochDlp {
        uint256 performanceRating;
        uint256 stakeAmountAdjustment;
    }

    struct Epoch {
        uint256 totalPerformanceRating;
        bool finalized; //deprecated
        mapping(uint256 dlpId => EpochDlp epochDlp) dlps;
    }

    struct DlpRating {
        uint256 dlpId;
        uint256 rating;
    }

    struct EpochInfo {
        uint256 totalPerformanceRating;
        bool finalized;
    }

    struct EpochDlpInfo {
        uint256 performanceRating;
        uint256 stakeAmountAdjustment;
    }

    struct DlpPerformanceRating {
        uint256 dlpId;
        uint256 performanceRating;
    }

    struct StakeClaimableReward {
        uint256 totalClaimableAmount;
        StakeClaimableEpochReward[] stakeClaimableEpochRewards;
    }

    struct StakeClaimableEpochReward {
        uint256 epochId;
        uint256 claimableAmount;
        bool fullRewardAmount;
    }

    struct DlpRewardApy {
        uint256 dlpId;
        uint256 APY; //annual percentage yield for stakers
        uint256 EPY; //epoch percentage yield for stakers
    }

    function version() external pure returns (uint256);
    function dlpRoot() external view returns (IDLPRoot);
    function foundationWalletAddress() external view returns (address payable);
    function epochs(uint256 epochId) external view returns (EpochInfo memory);
    function epochDlps(uint256 epochId, uint256 dlpId) external view returns (EpochDlpInfo memory);
    function ratingPercentages(RatingType rating) external view returns (uint256);
    function topDlps(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) external view returns (DlpRating[] memory);
    function topDlpsDefaultPercentages(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds
    ) external view returns (DlpRating[] memory);
    function topDlpIds(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) external view returns (uint256[] memory);
    function topDlpIdsDefaultPercentages(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds
    ) external view returns (uint256[] memory);
    function estimatedDlpRewardPercentages(
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) external view returns (DlpRewardApy[] memory);
    function estimatedDlpRewardPercentagesDefault(
        uint256[] memory dlpIds
    ) external view returns (DlpRewardApy[] memory);
    function getMultiplier(uint256 index) external pure returns (uint256);
    function pause() external;
    function unpause() external;
    function updateDlpRoot(address dlpRootAddress) external;
    function updateFoundationWalletAddress(address payable newFoundationWalletAddress) external;
    function updateEpochDlpStakeAmountAdjustment(
        uint256 epochId,
        uint256 dlpId,
        uint256 adjustment,
        bool isAddition
    ) external;
    function saveEpochPerformanceRatings(
        uint256 epochId,
        bool shouldFinalize,
        DlpPerformanceRating[] memory dlpPerformanceRatings
    ) external;
    function finalizeEpoch(uint256 epochId) external;
    function updateRatingPercentages(uint256 stakeRatingPercentage, uint256 performanceRatingPercentage) external;
}
