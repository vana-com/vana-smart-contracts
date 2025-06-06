// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDLPRegistry {
    enum DlpStatus {
        None,
        Registered,
        Eligible,
        Deregistered
    }

    struct DlpInfo {
        uint256 id;
        address dlpAddress;
        address ownerAddress;
        address tokenAddress;
        address treasuryAddress;
        string name;
        string iconUrl;
        string website;
        string metadata;
        uint256 registrationBlockNumber;
        uint256 depositAmount;
        DlpStatus status;
        uint256 lpTokenId;
        bool isVerified;
    }

    function dlps(uint256 dlpId) external view returns (DlpInfo memory);
}
