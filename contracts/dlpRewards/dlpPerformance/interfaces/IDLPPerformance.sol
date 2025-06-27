// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDLPRegistry} from "../../dlpRegistry/interfaces/IDLPRegistry.sol";
import {IVanaEpoch} from "../../vanaEpoch/interfaces/IVanaEpoch.sol";

interface IDLPPerformance {
    struct EpochDlpPerformance {
        uint256 totalScore; //normalized score; sum of all scores in an epoch must be 1e18
        uint256 tradingVolume;
        uint256 uniqueContributors;
        uint256 dataAccessFees;
        uint256 tradingVolumeScore;
        uint256 uniqueContributorsScore;
        uint256 dataAccessFeesScore;
        uint256 tradingVolumeScorePenalty; //percentage of the total score that is deducted for trading volume
        uint256 uniqueContributorsScorePenalty; //percentage of the total score that is deducted for unique contributors
        uint256 dataAccessFeesScorePenalty; //percentage of the total score that is deducted for data access fees
    }

    struct EpochPerformance {
        mapping(uint256 dlpId => EpochDlpPerformance epochDlpPreformance) epochDlpPerformances;
        MetricWeights metricWeights; //weights for each metric used to calculate the total score
    }

    struct MetricWeights {
        //sum of all weights must be 1e18
        uint256 tradingVolume;
        uint256 uniqueContributors;
        uint256 dataAccessFees;
    }

    struct EpochDlpPerformanceInfo {
        uint256 totalScore;
        uint256 tradingVolume; //total trading volume of the DLP in the epoch
        uint256 uniqueContributors; // total unique contributors to the DLP in the epoch
        uint256 dataAccessFees; //total data access fees collected by the DLP in the epoch; measured in VANA
        uint256 tradingVolumeScore; //trading volume score calculated based on the total trading volume of eligible DLPs in the epoch
        uint256 uniqueContributorsScore; //unique contributors score calculated based on the total unique contributors of eligible DLPs in the epoch
        uint256 dataAccessFeesScore; //data access fees score calculated based on the total data access fees collected by eligible DLPs in the epoch
        uint256 tradingVolumeScorePenalty; //weight of the tradingVolumeScore that is deducted in the reward calculation
        uint256 uniqueContributorsScorePenalty; //weight of the uniqueContributorsScore that is deducted in the reward calculation
        uint256 dataAccessFeesScorePenalty; //weight of the dataAccessFeesScore that is deducted in the reward calculation
    }

    function version() external pure returns (uint256);
    function dlpRegistry() external view returns (IDLPRegistry);
    function vanaEpoch() external view returns (IVanaEpoch);

    function epochMetricWeights(uint256 epochId) external view returns (MetricWeights memory);

    function epochDlpPerformances(
        uint256 epochId,
        uint256 dlpId
    ) external view returns (EpochDlpPerformanceInfo memory);

    function metricWeights() external view returns (MetricWeights memory);

    function calculateEpochDlpRewards(
        uint256 epochId,
        uint256 dlpId
    ) external view returns (uint256 rewardAmount, uint256 penaltyAmount);

    function pause() external;
    function unpause() external;
    function updateDlpRegistry(address dlpRegistryAddress) external;
    function updateVanaEpoch(address vanaEpochAddress) external;

    function updateMetricWeights(MetricWeights calldata newMetricWeights) external;

    struct EpochDlpPerformanceInput {
        uint256 dlpId;
        uint256 tradingVolume;
        uint256 uniqueContributors;
        uint256 dataAccessFees;
        uint256 tradingVolumeScore;
        uint256 uniqueContributorsScore;
        uint256 dataAccessFeesScore;
    }
    function saveEpochPerformances(uint256 epochId, EpochDlpPerformanceInput[] calldata epochDlpPerformances) external;
    function confirmEpochFinalScores(uint256 epochId) external;
    function overrideEpochDlpReward(uint256 epochId, uint256 dlpId) external;
    function overrideEpochPerformances(
        uint256 epochId,
        EpochDlpPerformanceInput[] calldata newEpochDlpPerformances
    ) external;
    function overrideEpochDlpPenalty(
        uint256 epochId,
        uint256 dlpId,
        uint256 tradingVolumeScorePenalty,
        uint256 uniqueContributorsScorePenalty,
        uint256 dataAccessFeesScorePenalty
    ) external;
}
