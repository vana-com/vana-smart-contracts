// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDLPRegistry} from "../../dlpRegistry/interfaces/IDLPRegistry.sol";
import {IVanaEpoch} from "../../vanaEpoch/interfaces/IVanaEpoch.sol";
import {IDLPRewardSwap} from "../../dlpRewardSwap/interfaces/IDLPRewardSwap.sol";
import {ITreasury} from "../../../utils/treasury/interfaces/ITreasury.sol";

interface IDLPRewardDeployer {
    struct DistributedReward {
        uint256 amount;
        uint256 blockNumber;
        uint256 tokenRewardAmount;
        uint256 spareToken;
        uint256 spareVana;
        uint256 usedVanaAmount;
    }

    struct EpochDlpReward {
        uint256 totalDistributedAmount;
        uint256 tranchesCount;
        mapping(uint256 trancheId => DistributedReward distributedReward) distributedRewards;
        uint256 distributedPenaltyAmount;
    }

    struct EpochReward {
        mapping(uint256 dlpId => EpochDlpReward epochDlpReward) epochDlpRewards;
        uint256 distributionInterval; //number of blocks; usual 1 day ( 3600 * 24 / 6)
        uint256 numberOfTranches;
        uint256 remediationWindow; //number of blocks to wait before starting distributing rewards
    }

    function version() external pure returns (uint256);
    function dlpRegistry() external view returns (IDLPRegistry);
    function vanaEpoch() external view returns (IVanaEpoch);
    function dlpRewardSwap() external view returns (IDLPRewardSwap);
    function treasury() external view returns (ITreasury);
    function numberOfBlocksBetweenTranches() external view returns (uint256);
    function rewardPercentage() external view returns (uint256);
    function maximumSlippagePercentage() external view returns (uint256);

    struct EpochRewardInfo {
        uint256 distributionInterval; //number of blocks; usual 1 day ( 3600 * 24 / 6)
        uint256 numberOfTranches;
        uint256 remediationWindow; //number of blocks to wait before starting distributing rewards
    }
    function epochRewards(uint256 epochId) external view returns (EpochRewardInfo memory);

    struct EpochDlpRewardInfo {
        uint256 totalDistributedAmount;
        uint256 distributedPenaltyAmount;
        uint256 tranchesCount;
    }
    function epochDlpRewards(uint256 epochId, uint256 dlpId) external view returns (EpochDlpRewardInfo memory);
    function epochDlpDistributedRewards(
        uint256 epochId,
        uint256 dlpId
    ) external view returns (DistributedReward[] memory);

    function pause() external;
    function unpause() external;
    function updateDlpRegistry(address dlpRegistryAddress) external;
    function updateVanaEpoch(address vanaEpochAddress) external;
    function updateDlpRewardSwap(address dlpRewardSwapAddress) external;
    function updateTreasury(address treasuryAddress) external;
    function updateRewardPercentage(uint256 newRewardPercentage) external;
    function updateMaximumSlippagePercentage(uint256 newMaximumSlippagePercentage) external;
    function updateNumberOfBlocksBetweenTranches(uint256 newNumberOfBlocksBetweenTranches) external;
    function distributeRewards(uint256 epochId, uint256[] calldata dlpIds) external;
    function withdrawEpochDlpPenaltyAmount(uint256 epochId, uint256 dlpId, address recipientAddress) external;
    function initializeEpochRewards(
        uint256 epochId,
        uint256 distributionInterval,
        uint256 numberOfTranches,
        uint256 remediationWindow
    ) external;
}
