// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

interface IDLPRootDeprecated {
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
}
