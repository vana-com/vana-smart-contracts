// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {IVanaEpoch} from "../../../vanaEpoch/interfaces/IVanaEpoch.sol";
import {ITreasury} from "../../../../utils/treasury/interfaces/ITreasury.sol";

interface IDLPRegistry {
    enum DlpStatus {
        None,
        Registered,
        Eligible,
        Deregistered
    }

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
        bool isVerified;
    }

    // View functions for contract state and configuration
    function version() external pure returns (uint256);
    function vanaEpoch() external view returns (IVanaEpoch);
    function treasury() external view returns (ITreasury);
    function eligibleDlpsListValues() external view returns (uint256[] memory);
    function eligibleDlpsListCount() external view returns (uint256);
    function eligibleDlpsListAt(uint256 index) external view returns (uint256);

    function dlpRegistrationDepositAmount() external view returns (uint256);
    function dlpsCount() external view returns (uint256);

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
    function dlpsByAddress(address dlpAddress) external view returns (DlpInfo memory);
    function dlpIds(address dlpAddress) external view returns (uint256);
    function dlpNameToId(string calldata dlpName) external view returns (uint256);
    function dlpsByName(string calldata dlpName) external view returns (DlpInfo memory);

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
    function updateDlpVerification(uint256 dlpId, bool isVerified) external;
    function updateDlp(uint256 dlpId, DlpRegistration calldata dlpUpdateInfo) external;
    function deregisterDlp(uint256 dlpId) external;
    function updateDlpToken(uint256 dlpId, address tokenAddress, uint256 lpTokenId) external;
    function updateDlpTokenAndVerification(
        uint256 dlpId,
        address tokenAddress,
        uint256 lpTokenId,
        bool isVerify
    ) external;
}
