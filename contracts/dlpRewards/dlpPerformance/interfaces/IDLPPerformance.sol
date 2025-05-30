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
    }

    struct EpochPerformance {
        mapping(uint256 dlpId => EpochDlpPerformance epochDlpPreformance) epochDlpPerformances;
    }

    struct EpochDlpPerformanceInfo {
        uint256 totalScore;
        uint256 tradingVolume;
        uint256 uniqueContributors;
        uint256 dataAccessFees;
    }

    function version() external pure returns (uint256);
    function dlpRegistry() external view returns (IDLPRegistry);
    function vanaEpoch() external view returns (IVanaEpoch);
    function epochDlpPerformances(uint256 epochId, uint256 dlpId) external view returns (EpochDlpPerformanceInfo memory);

    function pause() external;
    function unpause() external;
    function updateDlpRegistry(address dlpRegistryAddress) external;
    function updateVanaEpoch(address vanaEpochAddress) external;

    struct EpochDlpPerformanceInput {
        uint256 dlpId;
        uint256 totalScore;
        uint256 tradingVolume;
        uint256 uniqueContributors;
        uint256 dataAccessFees;
    }
    function saveEpochPerformances(
        uint256 epochId,
        EpochDlpPerformanceInput[] calldata epochDlpPerformances,
        bool finalized
    ) external;
}
