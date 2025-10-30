// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {BuyAndBurnOrchestratorStorageV1} from "./interfaces/BuyAndBurnOrchestratorStorageV1.sol";
import {IBuyAndBurnOrchestrator} from "./interfaces/IBuyAndBurnOrchestrator.sol";
import {IBuyAndBurnSwap} from "./interfaces/IBuyAndBurnSwap.sol";
import {IDataAccessTreasury} from "../data/dataAccessTreasury/interfaces/IDataAccessTreasury.sol";

/**
 * @title BuyAndBurnOrchestratorImplementation
 * @notice Orchestrates the buy-and-burn mechanism for protocol revenue
 * @dev Main implementation contract using UUPS proxy pattern
 */
contract BuyAndBurnOrchestratorImplementation is
BuyAndBurnOrchestratorStorageV1,
AccessControlUpgradeable,
PausableUpgradeable,
ReentrancyGuardUpgradeable,
UUPSUpgradeable,
IBuyAndBurnOrchestrator
{
    using SafeERC20 for IERC20;
    using Address for address payable;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _dataAccessTreasury Data Access Treasury contract
     * @param _buyAndBurnSwap BuyAndBurnSwap contract
     * @param _protocolTreasury Protocol treasury address
     * @param _protocolSharePercentage Protocol share percentage (e.g., 2e17 = 20%)
     * @param _computeStakingPercentage Compute/staking percentage of protocol share
     * @param _epochDuration Epoch duration in seconds
     */
    function initialize(
        address _dataAccessTreasury,
        address _buyAndBurnSwap,
        address _protocolTreasury,
        uint256 _protocolSharePercentage,
        uint256 _computeStakingPercentage,
        uint256 _epochDuration
    ) external initializer {
        require(_dataAccessTreasury != address(0), BuyAndBurnOrchestrator__InvalidAddress());
        require(_buyAndBurnSwap != address(0), BuyAndBurnOrchestrator__InvalidAddress());
        require(_protocolTreasury != address(0), BuyAndBurnOrchestrator__InvalidAddress());
        require(_protocolSharePercentage <= 1e18, BuyAndBurnOrchestrator__InvalidPercentage());
        require(_computeStakingPercentage <= 1e18, BuyAndBurnOrchestrator__InvalidPercentage());

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        dataAccessTreasury = IDataAccessTreasury(_dataAccessTreasury);
        buyAndBurnSwap = IBuyAndBurnSwap(_buyAndBurnSwap);
        protocolTreasury = _protocolTreasury;
        protocolSharePercentage = _protocolSharePercentage;
        computeStakingPercentage = _computeStakingPercentage;
        epochDuration = _epochDuration;
        lastEpochTimestamp = block.timestamp;

        // Default slippage parameters (2% and 0.5%)
        singleBatchImpactThreshold = 2e16; // 2%
        perSwapSlippageCap = 5e15; // 0.5%

        // Whitelist VANA by default
        whitelistedTokens[VANA] = true;
    }

    /// @inheritdoc IBuyAndBurnOrchestrator
    function executeBuyAndBurn(
        address tokenIn,
        uint256 amount,
        DlpConfig[] calldata dlpConfigs
    ) external override onlyRole(MAINTAINER_ROLE) nonReentrant whenNotPaused {
        require(whitelistedTokens[tokenIn], BuyAndBurnOrchestrator__TokenNotWhitelisted());
        require(amount > 0, BuyAndBurnOrchestrator__InvalidAmount());

        // Pull funds from DataAccessTreasury
        _pullFunds(tokenIn, amount);

        // Split into protocol and DLP shares
        uint256 protocolAmount = (amount * protocolSharePercentage) / 1e18;
        uint256 dlpAmount = amount - protocolAmount;

        // Process protocol share
        _processProtocolShare(tokenIn, protocolAmount);

        // Process DLP share
        _processDlpShare(tokenIn, dlpAmount, dlpConfigs);

        emit FundsWithdrawn(tokenIn, amount);
    }

    /// @inheritdoc IBuyAndBurnOrchestrator
    function processPendingFunds(
        address tokenIn,
        DlpConfig[] calldata dlpConfigs
    ) external override onlyRole(MAINTAINER_ROLE) nonReentrant whenNotPaused {
        uint256 pendingProtocol = pendingProtocolFunds[tokenIn];
        uint256 pendingDlp = pendingDlpFunds[tokenIn];

        if (pendingProtocol > 0) {
            pendingProtocolFunds[tokenIn] = 0;
            _processProtocolShare(tokenIn, pendingProtocol);
        }

        if (pendingDlp > 0) {
            pendingDlpFunds[tokenIn] = 0;
            _processDlpShare(tokenIn, pendingDlp, dlpConfigs);
        }
    }

    /// @inheritdoc IBuyAndBurnOrchestrator
    function advanceEpoch() external override onlyRole(MAINTAINER_ROLE) {
        require(
            block.timestamp >= lastEpochTimestamp + epochDuration,
            BuyAndBurnOrchestrator__EpochNotReady()
        );

        lastEpochTimestamp = block.timestamp;
        emit EpochAdvanced(lastEpochTimestamp);
    }

    /**
     * @notice Process protocol share: swap to VANA if needed, split between treasury and burn
     * @param tokenIn Input token
     * @param amount Amount to process
     */
    function _processProtocolShare(address tokenIn, uint256 amount) internal {
        uint256 vanaAmount;

        if (tokenIn == VANA) {
            // Already VANA
            vanaAmount = amount;
        } else {
            // Swap tokenIn → VANA using BuyAndBurnSwap
            if (tokenIn != VANA) {
                IERC20(tokenIn).forceApprove(address(buyAndBurnSwap), amount);
            }

            (, , uint256 spareOut) = buyAndBurnSwap.swapAndAddLiquidity(
                IBuyAndBurnSwap.SwapAndAddLiquidityParams({
                    tokenIn: tokenIn,
                    tokenOut: VANA,
                    fee: 3000, // 0.3% pool fee
                    tokenOutRecipient: address(this),
                    spareTokenInRecipient: address(this),
                    amountIn: amount,
                    singleBatchImpactThreshold: singleBatchImpactThreshold,
                    perSwapSlippageCap: perSwapSlippageCap,
                    lpTokenId: 0 // No LP for protocol swaps
                })
            );

            vanaAmount = spareOut;
        }

        if (vanaAmount > 0) {
            // Split VANA: some to treasury, rest burn
            uint256 treasuryAmount = (vanaAmount * computeStakingPercentage) / 1e18;
            uint256 burnAmount = vanaAmount - treasuryAmount;

            // Transfer to protocol treasury
            if (treasuryAmount > 0) {
                payable(protocolTreasury).sendValue(treasuryAmount);
            }

            // Burn VANA
            if (burnAmount > 0) {
                payable(BURN_ADDRESS).sendValue(burnAmount);
            }

            emit ProtocolShareProcessed(tokenIn, amount, burnAmount, treasuryAmount);
        }
    }

    /**
     * @notice Process DLP share: distribute to each DLP and execute buy-and-burn
     * @param tokenIn Input token
     * @param totalAmount Total DLP amount
     * @param dlpConfigs DLP configurations with allocations
     */
    function _processDlpShare(
        address tokenIn,
        uint256 totalAmount,
        DlpConfig[] calldata dlpConfigs
    ) internal {
        uint256 vanaAmount;

        if (tokenIn == VANA) {
            // Already VANA
            vanaAmount = totalAmount;
        } else {
            // Swap tokenIn → VANA
            if (tokenIn != VANA) {
                IERC20(tokenIn).forceApprove(address(buyAndBurnSwap), totalAmount);
            }

            (, , uint256 spareOut) = buyAndBurnSwap.swapAndAddLiquidity(
                IBuyAndBurnSwap.SwapAndAddLiquidityParams({
                    tokenIn: tokenIn,
                    tokenOut: VANA,
                    fee: 3000,
                    tokenOutRecipient: address(this),
                    spareTokenInRecipient: address(this),
                    amountIn: totalAmount,
                    singleBatchImpactThreshold: singleBatchImpactThreshold,
                    perSwapSlippageCap: perSwapSlippageCap,
                    lpTokenId: 0
                })
            );

            vanaAmount = spareOut;
        }

        if (vanaAmount > 0) {
            // Process each DLP's share
            for (uint256 i = 0; i < dlpConfigs.length; i++) {
                DlpConfig memory dlp = dlpConfigs[i];

                if (dlp.shareAmount == 0) continue;

                if (dlp.dlpToken == address(0)) {
                    // DLP has no token - send VANA directly
                    payable(dlp.dlpAddress).sendValue(dlp.shareAmount);
                } else {
                    // DLP has token - swap VANA → DLPT and burn spare
                    (, , uint256 dlptBurned) = buyAndBurnSwap.swapAndAddLiquidity{value: dlp.shareAmount}(
                        IBuyAndBurnSwap.SwapAndAddLiquidityParams({
                            tokenIn: VANA,
                            tokenOut: dlp.dlpToken,
                            fee: dlp.poolFee,
                            tokenOutRecipient: BURN_ADDRESS,
                            spareTokenInRecipient: address(this),
                            amountIn: dlp.shareAmount,
                            singleBatchImpactThreshold: singleBatchImpactThreshold,
                            perSwapSlippageCap: perSwapSlippageCap,
                            lpTokenId: dlp.lpTokenId
                        })
                    );

                    emit DlpShareProcessed(dlp.dlpAddress, dlp.shareAmount, dlptBurned);
                }
            }
        }
    }

    /**
     * @notice Pull funds from DataAccessTreasury
     * @param token Token to pull
     * @param amount Amount to pull
     */
    function _pullFunds(address token, uint256 amount) internal {
        if (token == VANA) {
            // Pull native VANA from treasury
            dataAccessTreasury.withdraw(token, amount);
        } else {
            // Pull ERC20 from treasury
            dataAccessTreasury.withdraw(token, amount);
            require(
                IERC20(token).balanceOf(address(this)) >= amount,
                BuyAndBurnOrchestrator__InsufficientBalance()
            );
        }
    }

    // Admin functions

    /// @inheritdoc IBuyAndBurnOrchestrator
    function setTokenWhitelist(address token, bool whitelisted) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedTokens[token] = whitelisted;
        emit TokenWhitelisted(token, whitelisted);
    }

    /// @inheritdoc IBuyAndBurnOrchestrator
    function updateParameters(
        uint256 _protocolSharePercentage,
        uint256 _computeStakingPercentage,
        uint256 _singleBatchImpactThreshold,
        uint256 _perSwapSlippageCap
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_protocolSharePercentage <= 1e18, BuyAndBurnOrchestrator__InvalidPercentage());
        require(_computeStakingPercentage <= 1e18, BuyAndBurnOrchestrator__InvalidPercentage());

        protocolSharePercentage = _protocolSharePercentage;
        computeStakingPercentage = _computeStakingPercentage;
        singleBatchImpactThreshold = _singleBatchImpactThreshold;
        perSwapSlippageCap = _perSwapSlippageCap;

        emit ParametersUpdated(
            _protocolSharePercentage,
            _computeStakingPercentage,
            _singleBatchImpactThreshold,
            _perSwapSlippageCap
        );
    }

    /// @inheritdoc IBuyAndBurnOrchestrator
    function setProtocolTreasury(address _protocolTreasury) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_protocolTreasury != address(0), BuyAndBurnOrchestrator__InvalidAddress());
        protocolTreasury = _protocolTreasury;
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Authorize upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @notice Receive native VANA
     */
    receive() external payable {}
}
