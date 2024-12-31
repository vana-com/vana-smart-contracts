// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDLPRoot} from "../../root/interfaces/IDLPRoot.sol";

interface IDLPRootMetrics {
    enum RatingType {
        None,
        Stake,
        Performance
    }
    struct EpochDlp {
        uint256 performanceRating;
    }

    struct Epoch {
        uint256 totalPerformanceRating;
        bool finalized;
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
    }

    struct DlpPerformanceRating {
        uint256 dlpId;
        uint256 performanceRating;
    }

    function version() external pure returns (uint256);
    function dlpRoot() external view returns (IDLPRoot);
    function epochs(uint256 epochId) external view returns (EpochInfo memory);
    function epochDlps(uint256 epochId, uint256 dlpId) external view returns (EpochDlpInfo memory);
    function ratingPercentages(RatingType rating) external view returns (uint256);
    function topDlps(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds
    ) external view returns (DlpRating[] memory);
    function topDlpIds(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds
    ) external view returns (uint256[] memory);
    function estimatedDlpRewardPercentages(
        uint256[] memory dlpIds
    ) external view returns (IDLPRoot.DlpRewardApy[] memory);
    function getMultiplier(uint256 index) external pure returns (uint256);
    function pause() external;
    function unpause() external;
    function updateDlpRoot(address dlpRootAddress) external;
    function saveEpochPerformanceRatings(
        uint256 epochId,
        bool shouldFinalize,
        DlpPerformanceRating[] memory dlpPerformanceRatings
    ) external;
    function updateRatingPercentages(uint256 stakeRatingPercentage, uint256 performanceRatingPercentage) external;
}
