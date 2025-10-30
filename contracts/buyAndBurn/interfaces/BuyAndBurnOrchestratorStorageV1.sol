// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDataAccessTreasury} from "../../data/dataAccessTreasury/interfaces/IDataAccessTreasury.sol";
import {IBuyAndBurnSwap} from "./IBuyAndBurnSwap.sol";

/**
 * @title BuyAndBurnOrchestratorStorageV1
 * @notice Storage layout for BuyAndBurnOrchestrator V1
 */
abstract contract BuyAndBurnOrchestratorStorageV1 {
    /// @notice Role for maintainers who can execute buy-and-burn operations
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    /// @notice Native VANA token representation (address(0))
    address public constant VANA = address(0);

    /// @notice Burn address for all tokens
    address public constant BURN_ADDRESS = address(0);

    /// @notice Data Access Treasury contract
    IDataAccessTreasury public dataAccessTreasury;

    /// @notice BuyAndBurnSwap contract for executing swaps
    IBuyAndBurnSwap public buyAndBurnSwap;

    /// @notice Protocol treasury for compute/staking rewards
    address public protocolTreasury;

    /// @notice Percentage allocated to protocol (e.g., 20% = 2e17)
    uint256 public protocolSharePercentage;

    /// @notice Percentage of protocol share for compute/staking (e.g., 5% = 5e16)
    uint256 public computeStakingPercentage;

    /// @notice Whitelisted tokens that can be processed
    mapping(address => bool) public whitelistedTokens;

    /// @notice Pending protocol funds per token (for multi-step processing)
    mapping(address => uint256) public pendingProtocolFunds;

    /// @notice Pending DLP funds per token (for multi-step processing)
    mapping(address => uint256) public pendingDlpFunds;

    /// @notice Epoch duration (e.g., 1 day)
    uint256 public epochDuration;

    /// @notice Last epoch timestamp
    uint256 public lastEpochTimestamp;

    /// @notice Slippage parameters
    uint256 public singleBatchImpactThreshold;
    uint256 public perSwapSlippageCap;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}