// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IDLPRegistry} from "../../dlpRegistry/interfaces/IDLPRegistry.sol";
import {IDLPPerformance} from "../../dlpPerformance/interfaces/IDLPPerformance.sol";
import {IDLPRewardDeployer} from "../../dlpRewardDeployer/interfaces/IDLPRewardDeployer.sol";

interface IVanaEpoch {
    struct EpochDlp {
        uint256 rewardAmount;
        uint256 penaltyAmount;
        uint256 bonusAmount;
    }

    struct Epoch {
        uint256 startBlock;
        uint256 endBlock;
        uint256 rewardAmount;
        bool isFinalized;
        EnumerableSet.UintSet dlpIds; // Participating DLPs
        mapping(uint256 dlpId => EpochDlp epochDlp) dlps;
        EnumerableSet.UintSet dlpIdsWithBonus; // DLPs with bonus rewards
    }

    // View functions for contract state and configuration
    function version() external pure returns (uint256);
    function dlpRegistry() external view returns (IDLPRegistry);
    function dlpPerformance() external view returns (IDLPPerformance);
    function dlpRewardDeployer() external view returns (IDLPRewardDeployer);
    function epochSize() external view returns (uint256);
    function daySize() external view returns (uint256);
    function epochsCount() external view returns (uint256);

    // Read-only struct views
    struct EpochInfo {
        uint256 startBlock;
        uint256 endBlock;
        uint256 rewardAmount;
        bool isFinalized;
    }
    function epochs(uint256 epochId) external view returns (EpochInfo memory);
    function epochDlpIds(uint256 epochId) external view returns (uint256[] memory);
    function epochDlpIdsWithBonus(uint256 epochId) external view returns (uint256[] memory);
    function epochRewardAmount() external view returns (uint256);

    struct EpochDlpInfo {
        bool isTopDlp;
        uint256 rewardAmount;
        uint256 penaltyAmount;
        uint256 bonusAmount;
        uint256 distributedAmount;
        uint256 distributedPenaltyAmount;
    }
    function epochDlps(uint256 epochId, uint256 dlpId) external view returns (EpochDlpInfo memory);

    // Admin functions
    function pause() external;
    function unpause() external;
    function updateDaySize(uint256 newDaySize) external;
    function updateEpochSize(uint256 newEpochSize) external;
    function updateEpochRewardAmount(uint256 newEpochRewardAmount) external;

    function updateDlpRegistry(address dlpRegistryAddress) external;
    function updateDlpPerformance(address dlpPerformanceAddress) external;
    function updateDlpRewardDeployer(address dlpRewardDeployerAddress) external;

    function createEpochs() external;
    function createEpochsUntilBlockNumber(uint256 blockNumber) external;

    struct Rewards {
        uint256 dlpId;
        uint256 rewardAmount;
        uint256 penaltyAmount;
    }

    function saveEpochDlpRewards(uint256 epochId, Rewards[] calldata dlpRewards) external;
    function overrideEpochDlpReward(
        uint256 epochId,
        uint256 dlpId,
        uint256 rewardAmount,
        uint256 penaltyAmount
    ) external;
    function forceFinalizedEpoch(uint256 epochId) external;

    function updateEpoch(
        uint256 epochId,
        uint256 startBlock,
        uint256 endBlock,
        uint256 rewardAmount,
        Rewards[] calldata dlpRewards,
        bool isFinalized
    ) external;

    function addEpochDlpBonusAmount(uint256 epochId, uint256 dlpId, uint256 amount) external;
    function overrideEpochDlpBonusAmount(uint256 epochId, uint256 dlpId, uint256 amount) external;
}
