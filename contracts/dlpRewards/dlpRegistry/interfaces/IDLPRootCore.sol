// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IDLPRootCore {
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
        DlpStatus status;
        uint256 registrationBlockNumber;
        uint256 stakeAmount;
        bool isVerified;
    }

    // DLP lifecycle states from registration to deregistration
    enum DlpStatus {
        None,
        Registered,
        Eligible, // Can participate in epochs
        SubEligible, // Below threshold but above minimum
        Deregistered
    }

    function dlps(uint256 dlpId) external view returns (DlpInfo memory);
}
