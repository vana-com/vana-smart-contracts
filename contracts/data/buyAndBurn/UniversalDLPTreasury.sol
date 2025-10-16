// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title UniversalDLPTreasury
 * @notice Manages DLP share funds and tracks liquidity contributions
 * @dev Handles per-DLP balance tracking and proportional VANA distribution
 */
contract UniversalDLPTreasury is AccessControlUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");

    // Per-DLP account tracking
    struct DLPAccount {
        uint256 usdcBalance; // USDC held for this DLP
        uint256 vanaBalance; // VANA held for this DLP
        uint256 liquidityContribution; // Liquidity added from protocol share attributable to this DLP
    }

    // State variables
    mapping(uint256 => DLPAccount) public dlpAccounts;

    uint256 public totalUSDC;
    uint256 public totalVANA;
    uint256 public totalLiquidityContribution;

    address public usdcToken;
    address public vanaToken;

    // Events
    event DLPDeposit(
        uint256 indexed dlpId,
        address indexed token,
        uint256 amount
    );
    event DLPWithdraw(
        uint256 indexed dlpId,
        address indexed token,
        uint256 amount,
        address indexed recipient
    );
    event LiquidityContributionTracked(
        uint256 indexed dlpId,
        uint256 amount
    );
    event VANADistributed(
        uint256 indexed dlpId,
        uint256 vanaAmount,
        uint256 usdcDeducted,
        uint256 liquidityDeducted
    );

    // Custom errors
    error InvalidToken();
    error InsufficientBalance();
    error InvalidAmount();
    error NoLiquidityToDistribute();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _usdcToken USDC token address
     * @param _vanaToken VANA token address
     * @param _orchestrator Orchestrator contract address
     * @param _owner Owner address
     */
    function initialize(
        address _usdcToken,
        address _vanaToken,
        address _orchestrator,
        address _owner
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        usdcToken = _usdcToken;
        vanaToken = _vanaToken;

        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(ORCHESTRATOR_ROLE, _orchestrator);
    }

    /**
     * @notice Deposit funds for a specific DLP
     * @param dlpId DLP identifier
     * @param token Token address (USDC or VANA)
     * @param amount Amount to deposit
     */
    function depositForDLP(
        uint256 dlpId,
        address token,
        uint256 amount
    ) external onlyRole(ORCHESTRATOR_ROLE) {
        if (token != usdcToken && token != vanaToken) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        // Transfer tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Update DLP account
        if (token == usdcToken) {
            dlpAccounts[dlpId].usdcBalance += amount;
            totalUSDC += amount;
        } else {
            dlpAccounts[dlpId].vanaBalance += amount;
            totalVANA += amount;
        }

        emit DLPDeposit(dlpId, token, amount);
    }

    /**
     * @notice Withdraw funds for a specific DLP
     * @param dlpId DLP identifier
     * @param token Token address
     * @param amount Amount to withdraw
     * @param recipient Recipient address
     */
    function withdrawForDLP(
        uint256 dlpId,
        address token,
        uint256 amount,
        address recipient
    ) external onlyRole(ORCHESTRATOR_ROLE) {
        if (token != usdcToken && token != vanaToken) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        // Check balance
        if (token == usdcToken) {
            if (dlpAccounts[dlpId].usdcBalance < amount) revert InsufficientBalance();
            dlpAccounts[dlpId].usdcBalance -= amount;
            totalUSDC -= amount;
        } else {
            if (dlpAccounts[dlpId].vanaBalance < amount) revert InsufficientBalance();
            dlpAccounts[dlpId].vanaBalance -= amount;
            totalVANA -= amount;
        }

        // Transfer tokens
        IERC20(token).safeTransfer(recipient, amount);

        emit DLPWithdraw(dlpId, token, amount, recipient);
    }

    /**
     * @notice Track liquidity contribution for a DLP
     * @dev Called when protocol share adds liquidity attributable to this DLP's revenue
     * @param dlpId DLP identifier
     * @param amount Liquidity amount to track
     */
    function trackLiquidityContribution(
        uint256 dlpId,
        uint256 amount
    ) external onlyRole(ORCHESTRATOR_ROLE) {
        if (amount == 0) revert InvalidAmount();

        dlpAccounts[dlpId].liquidityContribution += amount;
        totalLiquidityContribution += amount;

        emit LiquidityContributionTracked(dlpId, amount);
    }

    /**
     * @notice Distribute VANA to DLPs based on their liquidity contributions
     * @param dlpIds Array of DLP IDs to distribute to
     * @param totalVanaSwapped Total VANA received from swaps
     * @param totalUsdcUsed Total USDC used for swaps
     */
    /**
     * @notice Distribute VANA to DLPs based on their liquidity contributions
     * @param dlpIds Array of DLP IDs to distribute to
     * @param totalVanaSwapped Total VANA received from swaps
     * @param totalUsdcUsed Total USDC used for swaps
     */
    /**
     * @notice Distribute VANA to DLPs based on their liquidity contributions
     * @param dlpIds Array of DLP IDs to distribute to
     * @param totalVanaSwapped Total VANA received from swaps
     * @param totalUsdcUsed Total USDC used for swaps
     */
    function distributeVANA(
        uint256[] calldata dlpIds,
        uint256 totalVanaSwapped,
        uint256 totalUsdcUsed
    ) external onlyRole(ORCHESTRATOR_ROLE) {
        if (totalLiquidityContribution == 0) revert NoLiquidityToDistribute();

        // Save original total for proportional calculations
        uint256 originalTotalLiquidity = totalLiquidityContribution;

        for (uint256 i = 0; i < dlpIds.length; i++) {
            uint256 dlpId = dlpIds[i];
            DLPAccount storage account = dlpAccounts[dlpId];

            if (account.liquidityContribution == 0) continue;

            // Calculate proportional share based on ORIGINAL total liquidity
            uint256 vanaShare = (totalVanaSwapped * account.liquidityContribution) / originalTotalLiquidity;
            uint256 usdcShare = (totalUsdcUsed * account.liquidityContribution) / originalTotalLiquidity;

            // Verify sufficient balances
            if (account.usdcBalance < usdcShare) revert InsufficientBalance();
            if (account.liquidityContribution < usdcShare) revert InsufficientBalance();

            // Update USDC balance (deduct the amount used for buying VANA)
            account.usdcBalance -= usdcShare;
            totalUSDC -= usdcShare;

            // Add VANA to account
            account.vanaBalance += vanaShare;
            totalVANA += vanaShare;

            // Reduce liquidity contribution by amount used
            account.liquidityContribution -= usdcShare;
            totalLiquidityContribution -= usdcShare;

            emit VANADistributed(dlpId, vanaShare, usdcShare, usdcShare);
        }
    }

    /**
     * @notice Get DLP account details
     */
    function getDLPAccount(uint256 dlpId) external view returns (
        uint256 usdcBalance,
        uint256 vanaBalance,
        uint256 liquidityContribution
    ) {
        DLPAccount storage account = dlpAccounts[dlpId];
        return (
            account.usdcBalance,
            account.vanaBalance,
            account.liquidityContribution
        );
    }

    /**
     * @notice Authorize upgrade (UUPS pattern)
     */
    function _authorizeUpgrade(address newImplementation)
    internal
    override
    onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}
