// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IDLPRegistryForBuyAndBurn
 * @notice Local interface for DLPRegistry - contains only methods needed for Buy and Burn
 * @dev This avoids Solidity version conflicts with the main IDLPRegistry interface
 */
interface IDLPRegistryForBuyAndBurn {
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
        uint8 status;
        uint256 lpTokenId;
        uint256 verificationBlockNumber;
    }

    /**
     * @notice Get DLP information by ID
     * @param dlpId The DLP identifier
     * @return DLP information struct
     */
    function dlps(uint256 dlpId) external view returns (DlpInfo memory);

    /**
     * @notice Get all registered DLP IDs
     * @return Array of DLP IDs
     */
    function dlpIds() external view returns (uint256[] memory);
}