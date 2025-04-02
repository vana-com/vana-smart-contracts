// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IDLPRoot} from "../../root/interfaces/IDLPRoot.sol";
import {IDLPRootEpoch} from "../../rootEpoch/interfaces/IDLPRootEpoch.sol";
import {IDLPRootMetrics} from "../../rootMetrics/interfaces/IDLPRootMetrics.sol";

interface IDLPRootCoreReadOnly {
    struct DlpInfo {
        uint256 id;
        address dlpAddress;
        address ownerAddress;
        address treasuryAddress;
        uint256 stakersPercentage;
        uint256 stakersPercentageEpoch;
        string name;
        string iconUrl;
        string website;
        string metadata;
        IDLPRootCore.DlpStatus status;
        uint256 registrationBlockNumber;
        uint256 stakeAmount;
        bool isVerified;
    }

    function dlpsCount() external view returns (uint256);

    function dlps(uint256 dlpId) external view returns (DlpInfo memory);

    function dlpsByAddress(address dlpAddress) external view returns (DlpInfo memory);

    function dlpIds(address dlpAddress) external view returns (uint256);

    function dlpNameToId(string calldata dlpName) external view returns (uint256);

    function dlpsByName(string calldata dlpName) external view returns (DlpInfo memory);
}

interface IDLPRootCore is IDLPRootCoreReadOnly {
    // DLP lifecycle states from registration to deregistration
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
        bool isVerified;
    }

    // View functions for contract state and configuration
    function version() external pure returns (uint256);

    function dlpRoot() external view returns (IDLPRoot);

    function eligibleDlpsListValues() external view returns (uint256[] memory);

    function eligibleDlpsListCount() external view returns (uint256);

    function eligibleDlpsListAt(uint256 index) external view returns (uint256);

    function minDlpStakersPercentage() external view returns (uint256);

    function maxDlpStakersPercentage() external view returns (uint256);

    function minDlpRegistrationStake() external view returns (uint256);

    function dlpEligibilityThreshold() external view returns (uint256);

    function dlpSubEligibilityThreshold() external view returns (uint256);

    function eligibleDlpsLimit() external view returns (uint256);

    function dlpEpochStakeAmount(uint256 dlpId, uint256 epochId) external view returns (uint256);

    // Admin functions
    function pause() external;

    function unpause() external;

    function updateDlpStakersPercentages(
        uint256 newMinDlpStakersPercentage,
        uint256 newMaxDlpStakersPercentage
    ) external;

    function updateMinDlpRegistrationStake(uint256 newMinStakeAmount) external;

    function updateDlpEligibilityThresholds(
        uint256 newDlpSubEligibilityThreshold,
        uint256 newDlpEligibilityThreshold
    ) external;

    function updateDlpRoot(address newDlpRootAddress) external;

    struct DlpRegistration {
        address dlpAddress;
        address ownerAddress;
        address payable treasuryAddress;
        uint256 stakersPercentage;
        string name;
        string iconUrl;
        string website;
        string metadata;
    }

    // DLP lifecycle management
    function registerDlp(DlpRegistration calldata registrationInfo) external payable;

    function updateDlpVerification(uint256 dlpId, bool isVerified) external;

    function updateDlp(uint256 dlpId, DlpRegistration calldata dlpUpdateInfo) external;

    function deregisterDlp(uint256 dlpId) external;

    function addDlpStake(uint256 dlpId, uint256 amount) external;

    function removeDlpStake(uint256 dlpId, uint256 amount) external;
}
