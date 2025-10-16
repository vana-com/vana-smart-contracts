// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IBuyAndBurnOrchestrator
 * @notice Interface for the Buy and Burn Orchestrator
 */
interface IBuyAndBurnOrchestrator {
    /**
     * @notice Receive funds from data access payments
     * @param token Payment token address (USDC or VANA)
     * @param amount Payment amount
     * @param dlpId DLP identifier
     */
    function receiveFunds(
        address token,
        uint256 amount,
        uint256 dlpId
    ) external;

    /**
     * @notice Execute protocol share processing
     * @dev Called by authorized executor (cron service)
     */
    function executeProtocolShare() external;

    /**
     * @notice Execute DLP share processing
     * @param dlpIds Array of DLP IDs to process
     * @dev Called by authorized executor (cron service)
     */
    function executeDLPShare(uint256[] calldata dlpIds) external;
}
