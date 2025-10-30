// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IBuyAndBurnOrchestrator
 * @notice Interface for BuyAndBurnOrchestrator contract
 */
interface IBuyAndBurnOrchestrator {
    /// @notice DLP configuration
    struct DlpConfig {
        address dlpAddress;      // DLP identifier
        address dlpToken;        // DLP token address (address(0) if no token)
        uint256 shareAmount;     // Amount of VANA allocated to this DLP
        uint256 lpTokenId;       // LP position ID (0 if no LP/token)
        uint24 poolFee;          // Uniswap pool fee for VANA/DLPT pair
    }

    // Events
    event ProtocolShareProcessed(address indexed token, uint256 amount, uint256 burned, uint256 toTreasury);
    event DlpShareProcessed(address indexed dlpAddress, uint256 vanaAmount, uint256 dlptBurned);
    event FundsWithdrawn(address indexed token, uint256 amount);
    event TokenWhitelisted(address indexed token, bool whitelisted);
    event ParametersUpdated(
        uint256 protocolSharePercentage,
        uint256 computeStakingPercentage,
        uint256 singleBatchImpactThreshold,
        uint256 perSwapSlippageCap
    );
    event EpochAdvanced(uint256 newEpoch);

    // Errors
    error BuyAndBurnOrchestrator__TokenNotWhitelisted();
    error BuyAndBurnOrchestrator__InvalidAmount();
    error BuyAndBurnOrchestrator__InvalidAddress();
    error BuyAndBurnOrchestrator__InvalidPercentage();
    error BuyAndBurnOrchestrator__EpochNotReady();
    error BuyAndBurnOrchestrator__InsufficientBalance();

    /**
     * @notice Execute buy-and-burn for protocol and DLP shares
     * @param tokenIn Token to process (VANA or whitelisted token)
     * @param amount Total amount to process
     * @param dlpConfigs Configuration for each DLP
     */
    function executeBuyAndBurn(
        address tokenIn,
        uint256 amount,
        DlpConfig[] calldata dlpConfigs
    ) external;

    /**
     * @notice Process pending funds from previous incomplete swaps
     * @param tokenIn Token with pending funds
     * @param dlpConfigs DLP configurations for DLP pending funds
     */
    function processPendingFunds(
        address tokenIn,
        DlpConfig[] calldata dlpConfigs
    ) external;

    /**
     * @notice Advance to next epoch
     */
    function advanceEpoch() external;

    /**
     * @notice Whitelist or unwhitelist a token
     * @param token Token address
     * @param whitelisted Whitelist status
     */
    function setTokenWhitelist(address token, bool whitelisted) external;

    /**
     * @notice Update parameters
     */
    function updateParameters(
        uint256 _protocolSharePercentage,
        uint256 _computeStakingPercentage,
        uint256 _singleBatchImpactThreshold,
        uint256 _perSwapSlippageCap
    ) external;

    /**
     * @notice Update protocol treasury address
     */
    function setProtocolTreasury(address _protocolTreasury) external;
}
