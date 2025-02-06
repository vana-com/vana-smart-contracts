// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IDLPRootCore.sol";

abstract contract DLPRootCoreStorageV1 is IDLPRootCore {
    IDLPRoot public override dlpRoot;

    uint256 internal eligibleDlpsLimit;
    uint256 public override minDlpStakersPercentage; // Min % of rewards to stakers (in 1e18)
    uint256 public override maxDlpStakersPercentage; // Max % of rewards to stakers (in 1e18)
    uint256 public override minDlpRegistrationStake; // Min stake for new DLP registration
    uint256 public override dlpEligibilityThreshold; // Min stake for full eligibility
    uint256 public override dlpSubEligibilityThreshold; // Min stake for sub-eligibility

    uint256 public override daySize; // Blocks per day

    uint256 public override dlpsCount;
    mapping(uint256 dlpId => Dlp dlp) internal _dlps;
    mapping(address dlpAddress => uint256 dlpId) public override dlpIds;
    EnumerableSet.UintSet internal _eligibleDlpsList;

    mapping(string dlpName => uint256 dlpId) public override dlpNameToId;
}
