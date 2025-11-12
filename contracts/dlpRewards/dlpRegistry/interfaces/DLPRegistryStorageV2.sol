// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./IDLPRegistry.sol";

/**
 * @title DLPRegistryStorageV2
 * @notice Storage layout V2 - minimal extension of V1 with dataset field
 * @dev ONLY difference from V1: internal Dlp struct has datasetId field
 */
abstract contract DLPRegistryStorageV2 is IDLPRegistry {
    using EnumerableSet for EnumerableSet.UintSet;

    // Same as V1
    IVanaEpoch public override vanaEpoch;
    ITreasury public override treasury;
    uint256 public override dlpRegistrationDepositAmount;
    uint256 public override dlpsCount;

    // Internal struct with dataset support (extends base Dlp concept)
    struct DlpWithDataset {
        uint256 id;
        address dlpAddress;
        address ownerAddress;
        address tokenAddress;
        address payable treasuryAddress;
        string name;
        string iconUrl;
        string website;
        string metadata;
        uint256 registrationBlockNumber;
        uint256 depositAmount;
        IDLPRegistry.DlpStatus status;  // Reference enum from interface
        uint256 lpTokenId;
        uint256 verificationBlockNumber;
        uint256 datasetId; // NEW: only addition
    }

    // Use extended struct internally
    mapping(uint256 dlpId => DlpWithDataset dlp) internal _dlps;

    // Same as V1
    mapping(address dlpAddress => uint256 dlpId) public override dlpIds;
    mapping(string dlpName => uint256 dlpId) public override dlpNameToId;
    EnumerableSet.UintSet internal _eligibleDlpsList;

    uint256[50] private __gap;
}
