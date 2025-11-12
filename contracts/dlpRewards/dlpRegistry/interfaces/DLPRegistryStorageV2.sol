// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IVanaEpoch} from "../../vanaEpoch/interfaces/IVanaEpoch.sol";
import {ITreasury} from "../../../utils/treasury/interfaces/ITreasury.sol";

/**
 * @title IDLPRegistryV2
 * @notice Extended interface for DLPRegistry with Data Access V1 dataset support
 * @dev Adds dataset references to DLP entities while maintaining backward compatibility
 */
interface IDLPRegistryV2 {
    enum DlpStatus {
        None,
        Registered,
        Eligible,
        Deregistered
    }

    /**
     * @notice Internal DLP structure with dataset support
     * @dev Extended from V1 with datasetId field
     */
    struct Dlp {
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
        DlpStatus status;
        uint256 lpTokenId;
        uint256 verificationBlockNumber; // if 0 it means not verified
        uint256 datasetId; // NEW: Reference to associated dataset (0 if none)
    }

    // View functions for contract state and configuration
    function version() external pure returns (uint256);
    function vanaEpoch() external view returns (IVanaEpoch);
    function treasury() external view returns (ITreasury);
    function eligibleDlpsListValues() external view returns (uint256[] memory);
    function eligibleDlpsListCount() external view returns (uint256);
    function eligibleDlpsListAt(uint256 index) external view returns (uint256);
    function isEligibleDlp(uint256 dlpId) external view returns (bool);

    function dlpRegistrationDepositAmount() external view returns (uint256);
    function dlpsCount() external view returns (uint256);

    /**
     * @notice Public DLP info structure with dataset support
     * @dev Extended from V1 with datasetId field
     */
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
        uint256 verificationBlockNumber; // if 0 it means not verified
        uint256 datasetId; // NEW: Reference to associated dataset (0 if none)
    }

    function dlps(uint256 dlpId) external view returns (DlpInfo memory);
    function dlpsByAddress(address dlpAddress) external view returns (DlpInfo memory);
    function dlpIds(address dlpAddress) external view returns (uint256);
    function dlpNameToId(string calldata dlpName) external view returns (uint256);
    function dlpsByName(string calldata dlpName) external view returns (DlpInfo memory);

    // NEW: Dataset query function
    function getDlpDataset(uint256 dlpId) external view returns (uint256);

    // Admin functions
    function pause() external;
    function unpause() external;
    function updateTreasury(address newTreasuryAddress) external;
    function updateVanaEpoch(address newVanaEpochAddress) external;
    function updateDlpRegistrationDepositAmount(uint256 newDlpRegistrationDepositAmount) external;

    struct DlpRegistration {
        address dlpAddress;
        address ownerAddress;
        address payable treasuryAddress;
        string name;
        string iconUrl;
        string website;
        string metadata;
    }

    // DLP lifecycle management
    function registerDlp(DlpRegistration calldata registrationInfo) external payable;
    function updateDlpVerificationBlock(uint256 dlpId, uint256 verificationBlockNumber) external;
    function unverifyDlp(uint256 dlpId) external;
    function updateDlp(uint256 dlpId, DlpRegistration calldata dlpUpdateInfo) external;
    function deregisterDlp(uint256 dlpId) external;
    function updateDlpToken(uint256 dlpId, address tokenAddress, uint256 lpTokenId) external;
    function updateDlpTokenAndVerification(
        uint256 dlpId,
        address tokenAddress,
        uint256 lpTokenId,
        uint256 verificationBlockNumber
    ) external;

    // NEW: Dataset management
    function updateDlpDataset(uint256 dlpId, uint256 datasetId) external;
}

/**
 * @title DLPRegistryStorageV2
 * @notice Storage layout V2 for DLPRegistry with dataset support
 * @dev Extends V1 storage with dataset references
 */
abstract contract DLPRegistryStorageV2 is IDLPRegistryV2 {
    using EnumerableSet for EnumerableSet.UintSet;

    IVanaEpoch public override vanaEpoch;
    ITreasury public override treasury;

    uint256 public override dlpRegistrationDepositAmount;

    uint256 public override dlpsCount;
    mapping(uint256 dlpId => Dlp dlp) internal _dlps;
    mapping(address dlpAddress => uint256 dlpId) public override dlpIds;
    mapping(string dlpName => uint256 dlpId) public override dlpNameToId;

    EnumerableSet.UintSet internal _eligibleDlpsList;

    /**
     * @dev Gap for future storage variables
     * Reduced by 1 to account for potential future additions related to datasets
     */
    uint256[49] private __gap;
}
